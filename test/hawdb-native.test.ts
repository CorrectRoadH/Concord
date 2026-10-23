import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, linkSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { hawdbTarget } from '../src/hawdb-native-contract.js';
import { acquireHawdbClearGuard, createMemoryHawdb, hawdbIdentity, openHawdb, type HawdbFailureCode } from '../src/hawdb-native.js';
import { deleteInspectedCache, inspectCacheClear } from '../src/cache-file.js';

interface RawDatabase { get(namespace: string, keys: string[]): unknown; close(): void }
function rawEngine(path: string, admit = true): RawDatabase {
  const native = createRequire(import.meta.url)(join(process.cwd(), 'dist/native', hawdbTarget(), 'hawdb.node')) as {
    CacheBridge: { uncoordinatedForTest(path: string, readOnly: boolean, admit: boolean): RawDatabase };
  };
  return native.CacheBridge.uncoordinatedForTest(path, true, admit);
}

const childRole = process.env.CONCORD_HAWDB_CHILD_ROLE;
if (childRole) {
  const path = process.env.CONCORD_HAWDB_CHILD_PATH!;
  if (childRole === 'kill-batch') {
    const db = openHawdb(path, { readOnly: false, create: false });
    db.put('code_cache', [{ key: 'precommit', payload: 'not-visible' }]);
    process.exit(0);
  }
  const handle = childRole === 'guard' ? acquireHawdbClearGuard(path) : childRole === 'raw-database' ? rawEngine(path) : openHawdb(path, { readOnly: false, create: false });
  process.stdout.write('READY\n');
  process.on('SIGTERM', () => { handle.close(); process.exit(0); });
  setInterval(() => {}, 1_000);
} else {
  const artifact = JSON.parse(readFileSync(join(process.cwd(), 'dist/native', hawdbTarget(), 'artifact.json'), 'utf8')) as { testHooks?: boolean };
  const hooks = artifact.testHooks === true;
  function fixture(): { dir: string; db: string; cleanup(): void } {
    // macOS exposes its temporary directory through /var -> /private/var.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'concord-native-')));
    return { dir, db: join(dir, 'cache'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }
  function code(operation: () => unknown, expected: HawdbFailureCode): void {
    assert.throws(operation, (error: unknown) => error instanceof Error && 'code' in error && error.code === expected);
  }
  function diskSnapshot(path: string): readonly unknown[] {
    return readdirSync(path, { recursive: true }).map(String).sort().map(name => {
      const entry = join(path, name);
      const stat = statSync(entry, { bigint: true });
      return {
        name, inode: stat.ino, modified: stat.mtimeNs,
        digest: stat.isFile() ? createHash('sha256').update(readFileSync(entry)).digest('hex') : null,
      };
    });
  }
  async function child(role: 'guard' | 'database' | 'raw-database', path: string): Promise<ChildProcess> {
    const proc = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url)], {
      cwd: process.cwd(), env: { ...process.env, CONCORD_HAWDB_CHILD_ROLE: role, CONCORD_HAWDB_CHILD_PATH: path }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise<void>((resolve, reject) => {
      let output = '';
      let errors = '';
      proc.stdout!.on('data', (chunk: Buffer) => { output += chunk.toString(); if (output.includes('READY\n')) resolve(); });
      proc.stderr!.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
      proc.once('exit', (status) => reject(new Error(`child exited ${status}: ${errors}`)));
      setTimeout(() => reject(new Error(`child did not become ready: ${errors}`)), 15_000).unref();
    });
    return proc;
  }
  async function stop(proc: ChildProcess): Promise<void> {
    if (proc.exitCode !== null) return;
    await new Promise<void>((resolve) => { proc.once('exit', () => resolve()); proc.kill('SIGTERM'); });
  }

  test('real native identity, durable reopen, parameterized special key, rollback, and close', () => {
    const f = fixture();
    try {
      assert.equal(hawdbIdentity().engine, 'hawdb');
      const db = openHawdb(f.db, { readOnly: false, create: true });
      const key = `quote'\"; DROP TABLE x; -- \n Ω`;
      db.put('code_cache', [{ key, payload: 'value Ω' }]);
      assert.deepEqual(db.get('code_cache', [key]), [{ key, payload: 'value Ω' }]);
      code(() => db.put('code_cache', [{ key: 'good', payload: 'first' }, { key: '', payload: 'bad' }]), 'HawdbLimit');
      assert.deepEqual(db.get('code_cache', ['good']), []);
      assert.deepEqual(db.namespaces(), ['code_cache']);
      db.close(); db.close();
      code(() => db.get('code_cache', [key]), 'HawdbClosed');
      const reopened = openHawdb(f.db, { readOnly: true, create: false });
      assert.deepEqual(reopened.get('code_cache', [key]), [{ key, payload: 'value Ω' }]);
      reopened.close();
    } finally { f.cleanup(); }
  });
  test('atomic FIFO budget and mode restrictions', () => {
    const db = createMemoryHawdb();
    try {
      db.put('document_parse', [{ key: 'a', payload: '1' }, { key: 'b', payload: '2' }], { maxEntries: 2, maxBytes: 100 });
      db.put('document_parse', [{ key: 'c', payload: '3' }], { maxEntries: 2, maxBytes: 100 });
      assert.deepEqual(db.scan('document_parse').map(entry => entry.key), ['b', 'c']);
      code(() => db.put('document_parse', [{ key: 'x', payload: '123456789' }], { maxEntries: 1, maxBytes: 5 }), 'HawdbLimit');
      assert.deepEqual(db.scan('document_parse').map(entry => entry.key), ['b', 'c']);
      code(() => db.put('code_cache', [{ key: 'x', payload: 'y' }]), 'HawdbIncompatible');
      code(() => db.get('document_parse', Array.from({ length: 1001 }, (_, i) => String(i))), 'HawdbLimit');
    } finally { db.close(); }
  });
  test('bounded in-memory generations rebuild after repeated eviction; durable checkpoint reopens', () => {
    const memory = createMemoryHawdb();
    try {
      for (let i = 0; i < 2050; i++) memory.put('git_baseline', [{ key: String(i), payload: 'v' }], { maxEntries: 1, maxBytes: 100 });
      assert.deepEqual(memory.scan('git_baseline'), [{ key: '2049', payload: 'v' }]);
    } finally { memory.close(); }
    const f = fixture();
    try {
      const db = openHawdb(f.db, { readOnly: false, create: true });
      for (let i = 0; i < 34; i++) db.put('config_cache', [{ key: String(i), payload: 'value' }]);
      db.close();
      const reopened = openHawdb(f.db, { readOnly: true, create: false });
      assert.equal(reopened.scan('config_cache').length, 34); reopened.close();
    } finally { f.cleanup(); }
  });
  test('read-only existing-only preserves logical rows and source files without initializing missing storage', () => {
    const f = fixture();
    try {
      code(() => openHawdb(f.db, { readOnly: true, create: false }), 'HawdbUnavailable');
      assert.equal(existsSync(f.db), false);
      assert.equal(existsSync(`${f.db}.concord.lock`), false);
      const db = openHawdb(f.db, { readOnly: false, create: true });
      db.put('config_cache', [{ key: 'k', payload: 'v' }]); db.close();
      const sources = join(f.dir, 'sources'); mkdirSync(sources);
      for (const name of ['owner.md', 'evidence.json', 'journal.json']) writeFileSync(join(sources, name), 'source-owned bytes');
      const before = diskSnapshot(sources);
      const owner = statSync(join(f.db, 'owner.hawdb.lock')).ino;
      const coordination = statSync(`${f.db}.concord.lock`).ino;
      const ro = openHawdb(f.db, { readOnly: true, create: false });
      code(() => ro.put('config_cache', [{ key: 'x', payload: 'y' }]), 'HawdbIncompatible');
      assert.deepEqual(ro.scan('config_cache'), [{ key: 'k', payload: 'v' }]);
      ro.close();
      assert.deepEqual(diskSnapshot(sources), before);
      assert.equal(statSync(join(f.db, 'owner.hawdb.lock')).ino, owner);
      assert.equal(statSync(`${f.db}.concord.lock`).ino, coordination);
      const again = openHawdb(f.db, { readOnly: true, create: false });
      assert.deepEqual(again.scan('config_cache'), [{ key: 'k', payload: 'v' }]); again.close();
      rmSync(join(f.db, 'owner.hawdb.lock'));
      code(() => openHawdb(f.db, { readOnly: true, create: false }), 'HawdbUnavailable');
      assert.equal(existsSync(join(f.db, 'owner.hawdb.lock')), false);
    } finally { f.cleanup(); }
  });
  test('the real v0.3 cache is adopted without losing configuration or remote observations', () => {
    const f = fixture();
    const path = join(f.dir, 'cache.hawdb');
    try {
      execFileSync('tar', ['-xzf', fileURLToPath(new URL('./fixtures/hawdb/v0.3.0-cache.tar.gz', import.meta.url)), '-C', f.dir]);
      const inode = statSync(join(path, 'owner.hawdb.lock')).ino;
      const readonly = openHawdb(path, { readOnly: true, create: false });
      assert.deepEqual(readonly.scan('config_cache'), [{ key: 'legacy-config', payload: 'retained Ω config' }]); readonly.close();
      const upgraded = openHawdb(path, { readOnly: false, create: false });
      assert.deepEqual(upgraded.scan('feedback_cache'), [{ key: 'legacy-feedback', payload: 'retained remote observation' }]);
      upgraded.put('config_cache', [{ key: 'current', payload: 'new value' }]); upgraded.close();
      const reopened = openHawdb(path, { readOnly: true, create: false });
      assert.equal(reopened.scan('config_cache').length, 2);
      assert.deepEqual(reopened.scan('feedback_cache'), [{ key: 'legacy-feedback', payload: 'retained remote observation' }]); reopened.close();
      assert.equal(statSync(join(path, 'owner.hawdb.lock')).ino, inode);
    } finally { f.cleanup(); }
  });
  test('cross-process database and guard exclude both directions, preserve inode, and release', async () => {
    const f = fixture();
    let proc: ChildProcess | undefined;
    try {
      const db = openHawdb(f.db, { readOnly: false, create: true }); db.close();
      const lock = join(f.db, 'owner.hawdb.lock');
      const inode = statSync(lock).ino;
      const coordination = statSync(`${f.db}.concord.lock`).ino;
      proc = await child('database', f.db);
      code(() => acquireHawdbClearGuard(f.db), 'HawdbBusy');
      await stop(proc); proc = undefined;
      assert.equal(statSync(lock).ino, inode);
      proc = await child('guard', f.db);
      code(() => openHawdb(f.db, { readOnly: false, create: false }), 'HawdbBusy');
      await stop(proc); proc = undefined;
      const reopened = openHawdb(f.db, { readOnly: false, create: false }); reopened.close();
      assert.equal(statSync(lock).ino, inode);
      assert.equal(statSync(`${f.db}.concord.lock`).ino, coordination);
    } finally { if (proc) await stop(proc); f.cleanup(); }
  });
  test('clear excludes an unwrapped real branch engine across processes and preserves deferred admission fences', { skip: !hooks }, async () => {
    const f = fixture(); let proc: ChildProcess | undefined;
    const path = join(f.dir, 'cache.hawdb');
    try {
      const db = openHawdb(path, { readOnly: false, create: true });
      db.put('config_cache', [{ key: 'k', payload: 'v' }]); db.close();
      proc = await child('raw-database', path);
      code(() => acquireHawdbClearGuard(path), 'HawdbBusy');
      await stop(proc); proc = undefined;
      const deferred = rawEngine(path, false);
      const guard = acquireHawdbClearGuard(path);
      let beforeLockRemoval = false;
      let afterLockRemoval = false;
      try {
        assert.throws(() => rawEngine(path), /HawdbBusy/u);
        assert.throws(() => deferred.get('config_cache', ['k']), /HawdbBusy/u);
        const branchHead = readdirSync(path, { recursive: true }).map(String).find(name => name.endsWith('/branch.head'))!;
        assert.ok(branchHead);
        const branchLock = join(path, branchHead.replace(/branch\.head$/u, 'owner.hawdb.lock'));
        const inventory = inspectCacheClear(f.dir);
        deleteInspectedCache(inventory, () => {
          guard.verify();
          if (!existsSync(join(path, branchHead))) {
            if (existsSync(branchLock)) beforeLockRemoval = true;
            else afterLockRemoval = true;
            assert.throws(() => deferred.get('config_cache', ['k']), /HawdbBusy|HawdbUnavailable/u);
          }
        });
        assert.ok(beforeLockRemoval && afterLockRemoval, 'real deferred admission must be refused on both sides of lock unlink');
        assert.deepEqual(readdirSync(path), ['owner.hawdb.lock']);
      } finally { guard.close(); deferred.close(); }
      const reopened = openHawdb(path, { readOnly: false, create: true }); reopened.close();
    } finally { if (proc) await stop(proc); f.cleanup(); }
  });
  test('internal data aliases are safe but external aliases and linked ownership files are refused', () => {
    const f = fixture();
    try {
      const db = openHawdb(f.db, { readOnly: false, create: true }); db.close();
      mkdirSync(join(f.db, 'left')); mkdirSync(join(f.db, 'right'));
      const inside = join(f.db, 'left/data'); const alias = join(f.db, 'right/alias'); const outside = join(f.dir, 'outside');
      writeFileSync(inside, 'shared internal bytes'); linkSync(inside, alias);
      const guard = acquireHawdbClearGuard(f.db); guard.close();
      linkSync(inside, outside);
      code(() => acquireHawdbClearGuard(f.db), 'UnsafePath');
      code(() => openHawdb(f.db, { readOnly: true, create: false }), 'UnsafePath');
      rmSync(outside);
      const ownerAlias = join(f.db, 'owner-alias'); linkSync(join(f.db, 'owner.hawdb.lock'), ownerAlias);
      code(() => acquireHawdbClearGuard(f.db), 'UnsafePath'); rmSync(ownerAlias);
      const coordinated = `${f.db}.concord.lock`; linkSync(coordinated, outside);
      code(() => openHawdb(f.db, { readOnly: true, create: false }), 'UnsafePath'); rmSync(outside);
      const safe = acquireHawdbClearGuard(f.db); safe.close();
    } finally { f.cleanup(); }
  });
  test('corrupt manifest cannot authorize clear and still obeys lock', async () => {
    const f = fixture(); let proc: ChildProcess | undefined;
    try {
      const db = openHawdb(f.db, { readOnly: false, create: true }); db.close();
      writeFileSync(join(f.db, 'manifest.hawdb'), 'corrupt manifest');
      proc = await child('guard', f.db);
      code(() => openHawdb(f.db, { readOnly: false, create: false }), 'HawdbBusy');
      await stop(proc); proc = undefined;
      code(() => openHawdb(f.db, { readOnly: false, create: false }), 'HawdbUnavailable');
      const guard = acquireHawdbClearGuard(f.db); guard.close();
    } finally { if (proc) await stop(proc); f.cleanup(); }
  });
  test('unsafe symlink, hardlink, nonregular and unknown lock errors', () => {
    const f = fixture();
    try {
      const db = openHawdb(f.db, { readOnly: false, create: true }); db.close();
      const alias = join(f.dir, 'alias'); symlinkSync(f.db, alias);
      code(() => acquireHawdbClearGuard(alias), 'UnsafePath');
      const lock = join(f.db, 'owner.hawdb.lock'); const extra = join(f.dir, 'extra'); linkSync(lock, extra);
      code(() => acquireHawdbClearGuard(f.db), 'UnsafePath'); rmSync(extra);
      rmSync(lock); mkdirSync(lock);
      code(() => acquireHawdbClearGuard(f.db), 'UnsafePath');
      rmSync(lock, { recursive: true });
      // Missing manifest has no deletion authority; guard remains independently safe to acquire.
      const guard = acquireHawdbClearGuard(f.db); guard.close();
    } finally { f.cleanup(); }
  });
  test('test-hook failure inside real transaction rolls back all SQL mutations', { skip: !hooks }, () => {
    const f = fixture();
    try {
      const db = openHawdb(f.db, { readOnly: false, create: true });
      process.env.CONCORD_HAWDB_TEST_FAIL_AFTER_FIRST = '1';
      try { code(() => db.put('code_cache', [{ key: 'first', payload: '1' }, { key: 'second', payload: '2' }]), 'HawdbUnavailable'); }
      finally { delete process.env.CONCORD_HAWDB_TEST_FAIL_AFTER_FIRST; }
      assert.deepEqual(db.scan('code_cache'), []); db.close();
      const reopened = openHawdb(f.db, { readOnly: true, create: false });
      assert.deepEqual(reopened.scan('code_cache'), []); reopened.close();
    } finally { f.cleanup(); }
  });
  test('SIGKILL before native transaction commit has no half-visible batch', { skip: !hooks }, async () => {
    const f = fixture(); let proc: ChildProcess | undefined;
    try {
      const db = openHawdb(f.db, { readOnly: false, create: true }); db.close();
      const ready = join(f.dir, 'before-commit.ready');
      const release = join(f.dir, 'never-release');
      proc = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url)], {
        cwd: process.cwd(),
        env: { ...process.env, CONCORD_HAWDB_CHILD_ROLE: 'kill-batch', CONCORD_HAWDB_CHILD_PATH: f.db, CONCORD_HAWDB_TEST_READY: ready, CONCORD_HAWDB_TEST_RELEASE: release },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const deadline = Date.now() + 15_000;
      while (!existsSync(ready)) {
        if (proc.exitCode !== null) throw new Error(`writer exited before transaction hook: ${proc.exitCode}`);
        if (Date.now() > deadline) throw new Error('writer never reached transaction hook');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await new Promise<void>(resolve => { proc!.once('exit', () => resolve()); proc!.kill('SIGKILL'); });
      proc = undefined;
      const reopened = openHawdb(f.db, { readOnly: true, create: false });
      assert.deepEqual(reopened.scan('code_cache'), []); reopened.close();
    } finally { if (proc) proc.kill('SIGKILL'); f.cleanup(); }
  });

}
