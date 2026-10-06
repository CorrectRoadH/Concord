import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { cacheStatus, clearCache, scanAnnotations } from '../dist/annotations.js';
import { acquireHawdbClearGuard, hawdbIdentity, openHawdb } from '../dist/hawdb-native.js';
import { getWorkspaceSnapshot } from '../dist/application.js';
import { deleteInspectedCache, inspectCacheClear } from '../dist/cache-file.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import { ensureGenericPrivateDirectorySync } from '../dist/coordination.js';

const CacheReport = Schema.Struct({ status: Schema.String });
const ScanReport = Schema.Struct({ cache: CacheReport, codeCache: CacheReport });

function freshConsumer(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'concord-fresh-cache-')));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try { initialize(repo, false, { testRoots: ['test'], sourceRoots: ['src'] }); }
  finally { repo.close(); }
  // A fresh clone carries these source owners, but none of init's Git-private state.
  rmSync(join(root, '.git/concord'), { recursive: true, force: true });
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/example.ts'), 'export const example = true;\n');
  assert.equal(existsSync(join(root, '.git/concord')), false);
  return root;
}

function cli(root: string, ...args: string[]) {
  return spawnSync(process.execPath, ['dist/entry.js', '--root', root, '--json', ...args], { encoding: 'utf8', timeout: 30_000 });
}

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('fresh Git consumers create a private cache on check and hit it on the next command', () => Effect.runPromise(Effect.sync(() => {
  const root = freshConsumer();
  try {
    const cold = cli(root, 'check');
    const first = Schema.decodeUnknownSync(Schema.fromJsonString(ScanReport))(cold.stdout);
    assert.equal(first.cache.status, 'miss', cold.stdout + cold.stderr);
    assert.equal(first.codeCache.status, 'miss');
    const directory = join(root, '.git/concord');
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(existsSync(join(directory, 'cache.hawdb/owner.hawdb.lock')), true);
    const warm = cli(root, 'check');
    const second = Schema.decodeUnknownSync(Schema.fromJsonString(ScanReport))(warm.stdout);
    assert.equal(second.cache.status, 'hit', warm.stdout + warm.stderr);
    assert.equal(second.codeCache.status, 'hit');
    assert.equal(warm.status, cold.status, 'cache does not change the check verdict');
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('fresh cache rebuild produces ready projections and reports busy rebuilds as named failures', () => Effect.runPromise(Effect.sync(() => {
  const root = freshConsumer();
  try {
    const rebuilt = cli(root, 'cache', 'rebuild');
    assert.equal(rebuilt.status, 0, rebuilt.stdout + rebuilt.stderr);
    const report = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ cacheStatus: CacheReport })))(rebuilt.stdout);
    assert.equal(report.cacheStatus.status, 'ready');
    const status = cli(root, 'cache', 'status');
    assert.equal(status.status, 0, status.stdout + status.stderr);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(CacheReport))(status.stdout).status, 'ready');
    const database = openHawdb(join(root, '.git/concord/cache.hawdb'), { readOnly: false, create: false });
    try {
      const busy = cli(root, 'cache', 'rebuild');
      assert.equal(busy.status, 1, busy.stdout + busy.stderr);
      const error = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ error: Schema.Literal('CacheRebuildUnavailable') })))(busy.stderr);
      assert.equal(error.error, 'CacheRebuildUnavailable');
    } finally { database.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('fresh status, cache-off checks and dry-run previews leave Git-private state absent', () => Effect.runPromise(Effect.sync(() => {
  const root = freshConsumer();
  try {
    for (const args of [['cache', 'status'], ['--dry-run', 'check'], ['--dry-run', 'cache', 'clear'], ['--dry-run', 'cache', 'rebuild']]) {
      const result = cli(root, ...args);
      assert.equal(result.signal, null, result.stdout + result.stderr);
      if (args[0] === 'cache') { assert.equal(result.status, 0); assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(CacheReport))(result.stdout).status, 'empty'); }
      if (args.at(-1) === 'check') {
        const report = Schema.decodeUnknownSync(Schema.fromJsonString(ScanReport))(result.stdout);
        assert.equal(report.cache.status, 'off'); assert.equal(report.codeCache.status, 'off');
      }
      if (args.at(-1) === 'clear') assert.equal(result.status, 0, result.stdout + result.stderr);
      if (args.at(-1) === 'rebuild') { assert.equal(result.status, 1); assert.match(result.stderr, /InvalidOption/u); }
      assert.equal(existsSync(join(root, '.git/concord')), false, args.join(' '));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('cache initialization refuses symlinked private directories and directories outside Git', () => Effect.runPromise(Effect.sync(() => {
  const root = freshConsumer();
  const outside = mkdtempSync(join(tmpdir(), 'concord-cache-outside-'));
  try {
    assert.throws(() => ensureGenericPrivateDirectorySync(root, outside), /inside the selected Git directory/u);
    const link = join(root, '.git/concord');
    symlinkSync(outside, link);
    assert.throws(() => ensureGenericPrivateDirectorySync(root, link), /symbolic links/u);
    for (const args of [['check'], ['cache', 'rebuild'], ['cache', 'status'], ['--dry-run', 'cache', 'clear']]) {
      const result = cli(root, ...args);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /symlink|symbolic links/u);
      assert.equal(existsSync(join(outside, 'cache.hawdb')), false);
    }
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('cache-enabled workspace recovers an interrupted WAL without clearing committed cache entries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-cache-wal-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    const path = join(repo.privateDir, 'cache.hawdb');
    try { initialize(repo, false, { testRoots: [] }); scanAnnotations(repo); } finally { repo.close(); }
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', "import { openHawdb } from './dist/hawdb-native.js'; const db = openHawdb(process.argv[1], {readOnly:false,create:false}); db.put('config_cache', [{key:'interrupted',payload:'committed'}]); process.kill(process.pid, 'SIGKILL');", path], { encoding: 'utf8', timeout: 15000 });
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    assert.throws(() => openHawdb(path, { readOnly: true, create: false }), /read-only recovery requires an exact published row delta/u);
    await Effect.runPromise(getWorkspaceSnapshot(root, 'off'));
    assert.throws(() => openHawdb(path, { readOnly: true, create: false }), /read-only recovery requires an exact published row delta/u, 'cache-off must not repair the database');
    const snapshot = await Effect.runPromise(getWorkspaceSnapshot(root, 'use'));
    assert.equal(snapshot.complete, true);
    const recovered = openHawdb(path, { readOnly: true, create: false });
    try { assert.deepEqual(recovered.get('config_cache', ['interrupted']), [{ key: 'interrupted', payload: 'committed' }]); }
    finally { recovered.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
// @name oversized-cache-remains-recoverable
test('large cache directories remain readable and clearable without deleting the ownership inode', () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-large-cache-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try {
      initialize(repo);
      assert.equal(scanAnnotations(repo).cache.status, 'miss');
      const path = join(repo.privateDir, 'cache.hawdb');
      const inode = statSync(join(path, 'owner.hawdb.lock')).ino;
      const large = join(path, 'old-segment');
      writeFileSync(large, '');
      truncateSync(large, 257 * 1024 * 1024);
      for (let index = 0; index < 4100; index++) writeFileSync(join(path, `old-${index}`), '');
      assert.equal(scanAnnotations(repo).cache.status, 'hit');
      assert.notEqual(cacheStatus(repo).status, 'unavailable');
      assert.equal(clearCache(repo).status, 'cleared');
      assert.equal(statSync(join(path, 'owner.hawdb.lock')).ino, inode);
      assert.equal(scanAnnotations(repo).cache.status, 'miss');
      assert.equal(scanAnnotations(repo).cache.status, 'hit');
    } finally { repo.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('clear keeps the HawDB lock inode and removes only HawDB cache data', () => {
  assert.equal(hawdbIdentity().engine, 'hawdb');
  const root = mkdtempSync(join(tmpdir(), 'concord-hawdb-clear-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const initial = new LocalRepository(root, { initialize: true });
    try { initialize(initial); } finally { initial.close(); }
    const repo = new LocalRepository(root);
    try {
      const path = join(repo.privateDir, 'cache.hawdb');
      assert.equal(cacheStatus(repo).status, 'empty');
      assert.equal(existsSync(path), false);
      assert.equal(scanAnnotations(repo).cache.status, 'miss');
      const lock = join(path, 'owner.hawdb.lock');
      const inode = statSync(lock).ino;
      const unrelated = join(repo.privateDir, 'unrelated-data');
      writeFileSync(unrelated, 'preserve these bytes');
      assert.equal(clearCache(repo).status, 'cleared');
      assert.equal(existsSync(unrelated), true);
      assert.equal(statSync(lock).ino, inode);
      assert.equal(cacheStatus(repo).status, 'empty');
      assert.equal(clearCache(repo).status, 'empty');
      assert.equal(statSync(lock).ino, inode);
      const unsafe = join(path, 'unexpected-link');
      symlinkSync(join(repo.privateDir, 'absent'), unsafe);
      assert.throws(() => clearCache(repo), /Unsupported cache entry|UnsafePath/u);
      assert.equal(statSync(lock).ino, inode);
      rmSync(unsafe);
    } finally { repo.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('clear rejects an ownership inode replacement and a link introduced after inspection', () => {
  for (const mutation of ['owner', 'link']) {
    const root = mkdtempSync(join(tmpdir(), 'concord-clear-race-'));
    const path = join(root, 'cache.hawdb');
    const guard = acquireHawdbClearGuard(path);
    try {
      const sentinel = join(root, 'sentinel');
      writeFileSync(sentinel, 'keep');
      const inventory = inspectCacheClear(root);
      if (mutation === 'owner') {
        renameSync(join(path, 'owner.hawdb.lock'), join(root, 'old-owner'));
        writeFileSync(join(path, 'owner.hawdb.lock'), '');
      } else symlinkSync(sentinel, join(path, 'changed'));
      assert.throws(() => deleteInspectedCache(inventory, guard.verify), { code: 'UnsafePath' });
      assert.equal(readFileSync(sentinel, 'utf8'), 'keep');
    } finally { guard.close(); rmSync(root, { recursive: true, force: true }); }
  }
});

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('failed native close still releases the outer repository lease', () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-hawdb-close-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const initial = new LocalRepository(root, { initialize: true });
    try { initialize(initial); } finally { initial.close(); }
    const repo = new LocalRepository(root);
    const unsafe = join(repo.privateDir, 'cache.hawdb', 'unexpected-link');
    try {
      assert.throws(() => repo.snapshot(() => {
        scanAnnotations(repo);
        symlinkSync(join(root, 'absent'), unsafe);
      }), /UnsafePath|symlink/u);
      rmSync(unsafe);
      const reopened = new LocalRepository(root);
      try { assert.equal(scanAnnotations(reopened).cache.status, 'hit'); }
      finally { reopened.close(); }
    } finally { repo.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
