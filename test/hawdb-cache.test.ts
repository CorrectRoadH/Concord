import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { cacheStatus, clearCache, scanAnnotations } from '../dist/annotations.js';
import { hawdbIdentity } from '../dist/hawdb-native.js';
import { initialize, LocalRepository } from '../dist/storage.js';

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('clear keeps the HawDB lock inode and removes only bounded cache data and explicit SQLite remnants', () => {
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
      const legacy = join(repo.privateDir, 'cache.sqlite-wal');
      writeFileSync(legacy, 'old disposable bytes');
      assert.equal(clearCache(repo).status, 'cleared');
      assert.equal(existsSync(legacy), false);
      assert.equal(statSync(lock).ino, inode);
      assert.equal(cacheStatus(repo).status, 'empty');
      assert.equal(clearCache(repo).status, 'empty');
      assert.equal(statSync(lock).ino, inode);
      const unsafe = join(repo.privateDir, 'cache.sqlite-journal');
      symlinkSync(join(repo.privateDir, 'absent'), unsafe);
      assert.throws(() => clearCache(repo), /Legacy cache|UnsafePath/u);
      assert.equal(statSync(lock).ino, inode);
      rmSync(unsafe);
    } finally { repo.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
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
