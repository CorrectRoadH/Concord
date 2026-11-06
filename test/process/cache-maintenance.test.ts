// 跨进程保证：原生模块与句柄——维护worker在publication争用时释放native锁并延后删除，后续回收保留持久owner inode。
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
      const report = cacheStatus(repo, nativeRuntime);
      assert.equal(report.physicalLimitBytes, 224 * 1024 * 1024);
      assert.equal(report.physicalBytes, cachePhysicalBytes(f.privateDir));
    } finally { repo.close(); }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('default-limits native reclamation preserves logical rows and refuses memory or readonly handles', () => Effect.runPromise(Effect.sync(() => {
  const f = fixture();
  try {
    const db = openHawdb(f.path, { readOnly: false, create: false }, nativeRuntime);
    try {
      for (let i = 0; i < 12; i++) db.put('config_cache', [{ key: 'cycles', payload: String(i) }]);
      const report = db.reclaim();
      assert.equal(report.deferredForActiveLeases, false);
      assert.ok(report.reclaimedObjects > 0, 'the real engine swept unreachable objects');
      assert.ok(report.reclaimedBytes > 0);
      assert.equal(db.get('config_cache', ['cycles'])[0]?.payload, '11');
    } finally { db.close(); }
    assert.equal(read(f.path)[0]?.payload, 'a current logical value');
    const readonly = openHawdb(f.path, { readOnly: true, create: false }, nativeRuntime);
    try { assert.throws(() => readonly.reclaim(), { code: 'HawdbIncompatible' }); } finally { readonly.close(); }
    const memory = createMemoryHawdb(nativeRuntime);
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
    const rebuilt = spawnSync(process.execPath, [installedConcordCli(), '--root', f.root, '--json', 'cache', 'rebuild'], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(rebuilt.status, 0, rebuilt.stdout + rebuilt.stderr);
    const db = openHawdb(f.path, { readOnly: true, create: false }, nativeRuntime);
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

