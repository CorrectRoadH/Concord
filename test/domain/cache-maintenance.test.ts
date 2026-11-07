import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { PersistentCache, cachePhysicalBytes, openHawdb, createMemoryHawdb, HawdbFailure } from '../../src/base/cache/index.ts';
import { CACHE_MAINTENANCE_THRESHOLD_BYTES } from '../../src/base/installation/index.ts';
import { maintainCache, cacheMaintenanceNeeded } from '../../src/app/index.ts';
import { cacheStatus } from '../../src/domain/tests/index.ts';
import { initialize } from '../support/operations.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';

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
const read = (path: string) => {
  const db = openHawdb(path, { readOnly: true, create: false }, nativeRuntime);
  try { return db.get('config_cache', ['retained', 'concurrent-writer']); } finally { db.close(); }
};

// @feature docs/feature/local-data-engine/cli.md#缓存状态
test('physical status counts internal hard links once and reports the reclamation threshold without a physical limit', () => Effect.runPromise(Effect.sync(() => {
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
      assert.equal(Reflect.get(report, 'reclaimThresholdBytes'), 1024 * 1024 * 1024);
      assert.equal('physicalLimitBytes' in report, false);
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
test('native sweep budget and I/O failures defer even an oversized cache and release the handle', async () => {
  const f = fixture();
  const db = openHawdb(f.path, { readOnly: false, create: false }, nativeRuntime);
  const boundary = Object.getPrototypeOf(db) as { reclaim: typeof db.reclaim };
  const reclaim = boundary.reclaim;
  db.close();
  try {
    pad(f.padding, CACHE_MAINTENANCE_THRESHOLD_BYTES + 1);
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
// @issue docs/issues/maintenance-restarts-computation.md
test('reclamation preserves an arbitrarily large cache and waits for 256 MiB of further growth', async () => {
  const f = fixture();
  try {
    pad(f.padding, 1024 * 1024 * 1024 + 1);
    assert.equal(await runApplication(cacheMaintenanceNeeded(f.privateDir)), true);
    assert.equal(await runApplication(maintainCache(f.root).pipe(Effect.provide(PersistentCache.layer))), 'reclaimed');
    assert.equal(existsSync(f.padding), true);
    assert.equal(await runApplication(cacheMaintenanceNeeded(f.privateDir)), false);
    const after = cachePhysicalBytes(f.privateDir);
    pad(f.padding, 1024 * 1024 * 1024 + 1 + 256 * 1024 * 1024);
    assert.ok(cachePhysicalBytes(f.privateDir) >= after + 256 * 1024 * 1024);
    assert.equal(await runApplication(cacheMaintenanceNeeded(f.privateDir)), false, 'exactly 256 MiB is not more than the growth threshold');
    truncateSync(f.padding, 1024 * 1024 * 1024 + 2 + 256 * 1024 * 1024);
    assert.equal(await runApplication(cacheMaintenanceNeeded(f.privateDir)), true);
    assert.equal(read(f.path)[0]?.payload, 'a current logical value');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
