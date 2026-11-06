import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { runApplication } from '../support/repository.ts';
import { PersistentCache } from '../../src/base/cache/index.ts';
import { initialize } from '../support/operations.ts';
import { installedConcordCli } from '../support/support.ts';
import { sourceCli } from '../support/source-consumer.ts';
import { publicationService } from '../support/repository.ts';
import { workerEntryArgv, CACHE_MAINTENANCE_THRESHOLD_BYTES, CACHE_PHYSICAL_LIMIT_BYTES } from "../../src/base/installation/index.ts";
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect } from 'effect';
import { LocalRepository } from "../support/repository.ts";

import { cachePhysicalBytes } from "../../src/base/cache/index.ts";
import { cacheStatus } from "../../src/domain/tests/index.ts";
import { openHawdb, createMemoryHawdb, HawdbFailure } from "../../src/base/cache/index.ts";
import { maintainCache } from "../../src/app/index.ts";


import { sourceRoot, prepareSourceConsumer } from '../support/source-consumer.ts';
import { pollUntil } from '../support/support.ts';

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'concord-maintenance-')));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try { initialize(repo, false, { testRoots: [], sourceRoots: [] }); } finally { repo.close(); }
  const path = join(root, '.git/concord/cache.hawdb');
  const db = openHawdb(path, { readOnly: false, create: true }, nativeRuntime);
  db.put('config_cache', [{ key: 'retained', payload: 'a current logical value' }]); db.close();
  return { root, path, privateDir: join(root, '.git/concord'), padding: join(path, 'retained-padding') };
}
function pad(path: string, bytes: number) { writeFileSync(path, ''); truncateSync(path, bytes); }
function worker(root: string) {
  const result = spawnSync(process.execPath, [...workerEntryArgv('cache-maintenance-worker'), root], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
const read = (path: string) => {
  const db = openHawdb(path, { readOnly: true, create: false }, nativeRuntime);
  try { return db.get('config_cache', ['retained', 'concurrent-writer']); } finally { db.close(); }
};
async function settle(root: string) {
  await pollUntil(async () => {
    const lines = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n');
    return lines.some(line => line.includes('cache-maintenance-worker.') && line.includes(root)) ? undefined : true;
  }, { description: 'detached cache maintenance to exit', timeoutMs: 30_000 });
}

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('native sweep budget and I/O failures defer even an oversized cache and release the handle', async () => {
  const f = fixture();
  const db = openHawdb(f.path, { readOnly: false, create: false }, nativeRuntime);
  const boundary = Object.getPrototypeOf(db) as { reclaim: typeof db.reclaim };
  const reclaim = boundary.reclaim;
  db.close();
  try {
    pad(f.padding, CACHE_PHYSICAL_LIMIT_BYTES + 1);
    // Inject only the external engine failure. The real worker opens and closes
    // the real database and must not turn either failure into discard authority.
    for (const code of ['HawdbLimit', 'HawdbUnavailable'] as const) {
      boundary.reclaim = () => { throw new HawdbFailure(code, 'injected sweep failure'); };
      assert.equal(await runApplication(maintainCache(f.root).pipe(Effect.provide(PersistentCache.layer))), 'deferred');
      assert.equal(existsSync(f.padding), true);
      assert.equal(read(f.path)[0]?.payload, 'a current logical value');
    }
  } finally { boundary.reclaim = reclaim; rmSync(f.root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('maintenance competing with another process holding and writing a handle exits without deletion', () => Effect.runPromise(Effect.tryPromise(async () => {
  const f = fixture();
  let holder: ChildProcess | undefined;
  try {
    pad(f.padding, CACHE_PHYSICAL_LIMIT_BYTES + 1);
    holder = spawn(process.execPath, [fileURLToPath(new URL('../support/cache-maintenance-holder.ts', import.meta.url)), f.path], { stdio: ['pipe', 'pipe', 'pipe'] });
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
test('a query service maintains an oversized cache while retaining ownership and accepting later queries', () => Effect.runPromise(Effect.tryPromise(async () => {
  const f = fixture(), install = join(f.root, 'installation');
  let installedEntry: string | undefined;
  try {
    mkdirSync(install);
    writeFileSync(join(install, 'package.json'), JSON.stringify({ name: 'maintenance-consumer', private: true, type: 'module' }));
    const entry = sourceCli();
    installedEntry = entry;
    const command = (...args: string[]) => spawnSync(process.execPath, [entry, '--root', f.root, '--json', ...args], { cwd: install, encoding: 'utf8', timeout: 30_000 });
    const rebuild = () => {
      const result = spawnSync(process.execPath, [entry, '--root', f.root, '--json', 'cache', 'rebuild'], { cwd: install, encoding: 'utf8', timeout: 30_000 });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    rebuild();
    pad(f.padding, CACHE_PHYSICAL_LIMIT_BYTES + 1);
    const result = spawnSync(process.execPath, [entry, '--root', f.root, '--json', 'check'], { cwd: install, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const owner = JSON.parse(command('server', 'status').stdout);
    assert.equal(owner.state, 'running');
    await pollUntil(async () => existsSync(f.padding) ? undefined : true, { description: 'service-owned oversized cache maintenance', timeoutMs: 45_000 });
    await pollUntil(async () => {
      const status = command('cache', 'status');
      return status.status === 0 && JSON.parse(status.stdout).status === 'ready' ? true : undefined;
    }, { description: 'service reopens its cache after maintenance', timeoutMs: 10_000 });
    assert.equal(JSON.parse(command('server', 'status').stdout).token, owner.token);
    rebuild();
    const rebuilt = spawnSync(process.execPath, [entry, '--root', f.root, '--json', 'check'], { cwd: install, encoding: 'utf8', timeout: 30_000 });
    assert.equal(rebuilt.status, 0, rebuilt.stdout + rebuilt.stderr);
    assert.equal(JSON.parse(rebuilt.stdout).ok, true);
    assert.ok(readdirSync(f.path).length > 1);
  } finally {
    if (installedEntry) {
      const stopped = spawnSync(process.execPath, [installedEntry, '--root', f.root, '--json', 'server', 'stop'], { encoding: 'utf8', timeout: 30_000 });
      assert.equal(stopped.status, 0, stopped.stdout + stopped.stderr);
      await pollUntil(async () => existsSync(join(f.privateDir, 'server/current.json')) ? undefined : true, { description: 'maintenance service releases its instance', timeoutMs: 10_000 });
    }
    await settle(f.root); rmSync(f.root, { recursive: true, force: true });
  }
})));
