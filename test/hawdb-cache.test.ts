import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { cacheStatus, clearCache, scanAnnotations } from '../dist/annotations.js';
import { acquireHawdbClearGuard, hawdbIdentity, openHawdb } from '../dist/hawdb-native.js';
import { getWorkspaceSnapshot } from '../dist/application.js';
import { deleteInspectedCache, inspectCacheClear } from '../dist/cache-file.js';
import { initialize, LocalRepository } from '../dist/storage.js';

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
