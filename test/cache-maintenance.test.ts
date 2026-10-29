import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect } from 'effect';
import { initialize, LocalRepository } from '../dist/storage.js';
import { cachePhysicalBytes } from '../dist/cache-file.js';
import { cacheStatus } from '../dist/annotations.js';
import { openHawdb, createMemoryHawdb, HawdbFailure } from '../dist/hawdb-native.js';
import { maintainCache } from '../dist/cache-maintenance-worker.js';
import { CACHE_MAINTENANCE_THRESHOLD_BYTES, CACHE_PHYSICAL_LIMIT_BYTES } from '../dist/hawdb-native-contract.js';
import { workerEntryArgv } from '../dist/installation.js';
import { packConcord, installConcord } from './installed-package.js';
import { pollUntil } from './support.js';

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'concord-maintenance-')));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try { initialize(repo, false, { testRoots: [], sourceRoots: [] }); } finally { repo.close(); }
  const path = join(root, '.git/concord/cache.hawdb');
  const db = openHawdb(path, { readOnly: false, create: true });
  db.put('config_cache', [{ key: 'retained', payload: 'a current logical value' }]); db.close();
  return { root, path, privateDir: join(root, '.git/concord'), padding: join(path, 'retained-padding') };
}
function pad(path: string, bytes: number) { writeFileSync(path, ''); truncateSync(path, bytes); }
function worker(root: string) {
  const result = spawnSync(process.execPath, [...workerEntryArgv('cache-maintenance-worker'), root], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
const read = (path: string) => {
  const db = openHawdb(path, { readOnly: true, create: false });
  try { return db.get('config_cache', ['retained', 'concurrent-writer']); } finally { db.close(); }
};
async function settle(root: string) {
  await pollUntil(async () => {
    const lines = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n');
    return lines.some(line => line.includes('cache-maintenance-worker.') && line.includes(root)) ? undefined : true;
  }, { description: 'detached cache maintenance to exit', timeoutMs: 30_000 });
}

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('physical status counts internal hard links once and reports the unchanged logical-budget hard limit', () => Effect.runPromise(Effect.sync(() => {
  const fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'concord-physical-')));
  const path = join(fixtureRoot, 'cache.hawdb');
  try {
    mkdirSync(path);
    writeFileSync(join(path, 'one'), '1234567890');
    linkSync(join(path, 'one'), join(path, 'two'));
    assert.equal(cachePhysicalBytes(fixtureRoot), 10);
    linkSync(join(path, 'one'), join(fixtureRoot, 'outside'));
    assert.throws(() => cachePhysicalBytes(fixtureRoot), { code: 'UnsafePath' });
  } finally { rmSync(fixtureRoot, { recursive: true, force: true }); }
  const f = fixture();
  try {
    const repo = new LocalRepository(f.root, { access: 'read' });
    try {
      const report = cacheStatus(repo);
      assert.equal(report.physicalLimitBytes, 224 * 1024 * 1024);
      assert.equal(report.physicalBytes, cachePhysicalBytes(f.privateDir));
    } finally { repo.close(); }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('default-limits native reclamation preserves logical rows and refuses memory or readonly handles', () => Effect.runPromise(Effect.sync(() => {
  const f = fixture();
  try {
    const db = openHawdb(f.path, { readOnly: false, create: false });
    try {
      for (let i = 0; i < 12; i++) db.put('config_cache', [{ key: 'cycles', payload: String(i) }]);
      const report = db.reclaim();
      assert.equal(report.deferredForActiveLeases, false);
      assert.ok(report.reclaimedObjects > 0, 'the real engine swept unreachable objects');
      assert.ok(report.reclaimedBytes > 0);
      assert.equal(db.get('config_cache', ['cycles'])[0]?.payload, '11');
    } finally { db.close(); }
    assert.equal(read(f.path)[0]?.payload, 'a current logical value');
    const readonly = openHawdb(f.path, { readOnly: true, create: false });
    try { assert.throws(() => readonly.reclaim(), { code: 'HawdbIncompatible' }); } finally { readonly.close(); }
    const memory = createMemoryHawdb();
    try { assert.throws(() => memory.reclaim(), { code: 'HawdbIncompatible' }); } finally { memory.close(); }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('the maintenance worker reclaims below the hard cap, and discards only a still oversized cache', () => Effect.runPromise(Effect.sync(() => {
  const f = fixture();
  try {
    pad(f.padding, CACHE_MAINTENANCE_THRESHOLD_BYTES + 1);
    worker(f.root);
    assert.equal(existsSync(f.padding), true, '48 MiB admission does not imply discard');
    assert.equal(read(f.path)[0]?.payload, 'a current logical value');
    pad(f.padding, CACHE_PHYSICAL_LIMIT_BYTES + 1);
    const owner = statSync(join(f.path, 'owner.hawdb.lock')).ino;
    const external = statSync(`${f.path}.concord.lock`).ino;
    worker(f.root);
    assert.deepEqual(readdirSync(f.path), ['owner.hawdb.lock']);
    assert.equal(statSync(join(f.path, 'owner.hawdb.lock')).ino, owner);
    assert.equal(statSync(`${f.path}.concord.lock`).ino, external);
    const rebuilt = spawnSync(process.execPath, ['dist/entry.js', '--root', f.root, '--json', 'cache', 'rebuild'], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(rebuilt.status, 0, rebuilt.stdout + rebuilt.stderr);
    const db = openHawdb(f.path, { readOnly: true, create: false });
    try { assert.ok(db.scan('annotation_cache').length > 0, 'cold command reconstructs projections'); } finally { db.close(); }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('publication contention defers discard after releasing native locks, and later maintenance retries', () => Effect.runPromise(Effect.sync(() => {
  const f = fixture();
  const publisher = new LocalRepository(f.root);
  try {
    pad(f.padding, CACHE_PHYSICAL_LIMIT_BYTES + 1);
    publisher.beginSnapshot();
    worker(f.root);
    assert.equal(existsSync(f.padding), true);
    assert.equal(read(f.path)[0]?.payload, 'a current logical value', 'native locks are released even while publication is occupied');
    publisher.endSnapshot();
    worker(f.root);
    assert.deepEqual(readdirSync(f.path), ['owner.hawdb.lock']);
  } finally { publisher.close(); rmSync(f.root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('native sweep budget and I/O failures defer even an oversized cache and release the handle', () => Effect.runPromise(Effect.sync(() => {
  const f = fixture();
  const db = openHawdb(f.path, { readOnly: false, create: false });
  const boundary = Object.getPrototypeOf(db) as { reclaim: typeof db.reclaim };
  const reclaim = boundary.reclaim;
  db.close();
  try {
    pad(f.padding, CACHE_PHYSICAL_LIMIT_BYTES + 1);
    // Inject only the external engine failure. The real worker opens and closes
    // the real database and must not turn either failure into discard authority.
    for (const code of ['HawdbLimit', 'HawdbUnavailable'] as const) {
      boundary.reclaim = () => { throw new HawdbFailure(code, 'injected sweep failure'); };
      assert.equal(maintainCache(f.root), 'deferred');
      assert.equal(existsSync(f.padding), true);
      assert.equal(read(f.path)[0]?.payload, 'a current logical value');
    }
  } finally { boundary.reclaim = reclaim; rmSync(f.root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('maintenance competing with another process holding and writing a handle exits without deletion', () => Effect.runPromise(Effect.tryPromise(async () => {
  const f = fixture();
  let holder: ChildProcess | undefined;
  try {
    pad(f.padding, CACHE_PHYSICAL_LIMIT_BYTES + 1);
    holder = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('./cache-maintenance-holder.ts', import.meta.url)), f.path], { stdio: ['pipe', 'pipe', 'pipe'] });
    const wait = (word: string) => new Promise<void>((resolve, reject) => {
      const proc = holder!;
      let seen = '';
      const timeout = setTimeout(() => reject(new Error(`writer did not emit ${word}`)), 30_000);
      const output = (chunk: Buffer) => { seen += chunk.toString(); if (seen.includes(word)) { clearTimeout(timeout); proc.stdout!.off('data', output); resolve(); } };
      proc.stdout!.on('data', output);
      proc.once('error', reject);
      proc.once('exit', code => { clearTimeout(timeout); reject(new Error(`writer exited ${code}`)); });
    });
    await wait('READY');
    const written = wait('WROTE'); holder.stdin!.write('write\n');
    worker(f.root);
    await written;
    assert.equal(existsSync(f.padding), true);
    await new Promise<void>(resolve => { holder!.once('exit', () => resolve()); holder!.kill('SIGTERM'); });
    holder = undefined;
    assert.equal(read(f.path).find(row => row.key === 'concurrent-writer')?.payload, 'current writer value');
  } finally {
    if (holder !== undefined && holder.exitCode === null) await new Promise<void>(resolve => { holder!.once('exit', () => resolve()); holder!.kill('SIGTERM'); });
    rmSync(f.root, { recursive: true, force: true });
  }
})));

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('a packed public command launches detached maintenance and the next process rebuilds cold', () => Effect.runPromise(Effect.tryPromise(async () => {
  const f = fixture(), install = join(f.root, 'installation');
  try {
    mkdirSync(install);
    writeFileSync(join(install, 'package.json'), JSON.stringify({ name: 'maintenance-consumer', private: true, type: 'module' }));
    installConcord(install, packConcord(f.root));
    const entry = join(install, 'node_modules/concord-sdlc/dist/entry.js');
    pad(f.padding, CACHE_PHYSICAL_LIMIT_BYTES + 1);
    const result = spawnSync(process.execPath, [entry, '--root', f.root, '--json', 'check'], { cwd: install, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const launched = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n').some(line => line.includes('cache-maintenance-worker.js') && line.includes(f.root));
    assert.ok(launched || !existsSync(f.padding), 'the worker starts before the public command exits');
    await pollUntil(async () => existsSync(f.padding) ? undefined : true, { description: 'oversized cache to be discarded' });
    await settle(f.root);
    assert.deepEqual(readdirSync(f.path), ['owner.hawdb.lock']);
    const rebuilt = spawnSync(process.execPath, [entry, '--root', f.root, '--json', 'check'], { cwd: install, encoding: 'utf8', timeout: 30_000 });
    assert.equal(rebuilt.status, 0, rebuilt.stdout + rebuilt.stderr);
    assert.deepEqual(JSON.parse(rebuilt.stdout), JSON.parse(result.stdout));
    assert.ok(readdirSync(f.path).length > 1);
  } finally { await settle(f.root); rmSync(f.root, { recursive: true, force: true }); }
})));
