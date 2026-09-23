import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, realpathSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, linkSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { hawdbTarget } from '../src/hawdb-native-contract.js';
import { acquireHawdbClearGuard, createMemoryHawdb, hawdbIdentity, openHawdb, type HawdbFailureCode } from '../src/hawdb-native.js';

const childRole = process.env.CONCORD_HAWDB_CHILD_ROLE;
if (childRole) {
  const path = process.env.CONCORD_HAWDB_CHILD_PATH!;
  if (childRole === 'kill-batch') {
    const db = openHawdb(path, { readOnly: false, create: false });
    db.put('code_cache', [{ key: 'precommit', payload: 'not-visible' }]);
    process.exit(0);
  }
  const handle = childRole === 'guard' ? acquireHawdbClearGuard(path) : openHawdb(path, { readOnly: false, create: false });
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
  async function child(role: 'guard' | 'database', path: string): Promise<ChildProcess> {
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
  test('read-only existing-only never writes or creates', () => {
    const f = fixture();
    try {
      code(() => openHawdb(f.db, { readOnly: true, create: false }), 'HawdbUnavailable');
      assert.equal(existsSync(f.db), false);
      const db = openHawdb(f.db, { readOnly: false, create: true });
      db.put('config_cache', [{ key: 'k', payload: 'v' }]); db.close();
      const before = readdirSync(f.db).sort();
      const hashes = before.filter(name => statSync(join(f.db, name)).isFile()).map(name => [name, createHash('sha256').update(readFileSync(join(f.db, name))).digest('hex')]);
      const ro = openHawdb(f.db, { readOnly: true, create: false });
      code(() => ro.put('config_cache', [{ key: 'x', payload: 'y' }]), 'HawdbIncompatible');
      assert.deepEqual(ro.scan('config_cache'), [{ key: 'k', payload: 'v' }]);
      ro.close();
      assert.deepEqual(readdirSync(f.db).sort(), before);
      assert.deepEqual(before.filter(name => statSync(join(f.db, name)).isFile()).map(name => [name, createHash('sha256').update(readFileSync(join(f.db, name))).digest('hex')]), hashes);
      rmSync(join(f.db, 'owner.hawdb.lock'));
      code(() => openHawdb(f.db, { readOnly: true, create: false }), 'HawdbUnavailable');
      assert.equal(existsSync(join(f.db, 'owner.hawdb.lock')), false);
    } finally { f.cleanup(); }
  });
  test('cross-process database and guard exclude both directions, preserve inode, and release', async () => {
    const f = fixture();
    let proc: ChildProcess | undefined;
    try {
      const db = openHawdb(f.db, { readOnly: false, create: true }); db.close();
      const lock = join(f.db, 'owner.hawdb.lock');
      const inode = statSync(lock).ino;
      proc = await child('database', f.db);
      code(() => acquireHawdbClearGuard(f.db), 'HawdbBusy');
      await stop(proc); proc = undefined;
      assert.equal(statSync(lock).ino, inode);
      proc = await child('guard', f.db);
      code(() => openHawdb(f.db, { readOnly: false, create: false }), 'HawdbBusy');
      await stop(proc); proc = undefined;
      const reopened = openHawdb(f.db, { readOnly: false, create: false }); reopened.close();
      assert.equal(statSync(lock).ino, inode);
    } finally { if (proc) await stop(proc); f.cleanup(); }
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
