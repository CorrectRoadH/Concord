// Cross-process guarantees: official C ABI ownership, lazy admission, clear and crash recovery.
import { loadHawDB, HawDBError } from '@nowledge/hawdb-bun';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { nativeArtifactRoot, nativeCacheRoot, hawdbTarget, verifiedHawdbLibrary } from '../../src/base/installation/index.ts';
import { acquireHawdbClearGuard, createMemoryHawdb, deleteInspectedCache, hawdbIdentity, inspectCacheClear, openHawdb, type HawdbFailureCode } from '../../src/base/cache/index.ts';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { tmpdir } from '../support/temporary.ts';

const runtime = makeRuntimeEnvironment(process.cwd(), process.env);
const childRole = process.env.CONCORD_HAWDB_CHILD_ROLE;
if (childRole) {
  const path = process.env.CONCORD_HAWDB_CHILD_PATH!;
  if (childRole === 'repair') {
    const binary = process.env.CONCORD_HAWDB_CHILD_BINARY!, original = process.env.CONCORD_HAWDB_CHILD_ORIGINAL!;
    for (let index = 0; index < 3; index++) assert.throws(() => hawdbIdentity(runtime), /native member bytes differ/u);
    writeFileSync(`${binary}.repair`, readFileSync(original)); renameSync(`${binary}.repair`, binary);
    assert.equal(hawdbIdentity(runtime).engine, 'hawdb');
    process.exit(0);
  }
  if (childRole === 'transaction') {
    const database = openHawdb(path, { readOnly: false, create: false }, runtime);
    database.atomic(() => {
      database.put('code_cache', [{ key: 'first', payload: 'uncommitted' }, { key: 'second', payload: 'uncommitted' }]);
      process.stdout.write('READY\n');
      // Block the real synchronous callback at a parent-controlled OS boundary.
      readSync(0, Buffer.alloc(1), 0, 1, null);
    });
    database.close(); process.exit(0);
  }
  const library = childRole.startsWith('official-') ? loadHawDB(verifiedHawdbLibrary(runtime).binary) : undefined;
  const database = library?.open(path, { durability: 'sync_on_every_write' });
  if (childRole === 'official-active') database!.querySQL('SELECT version FROM concord_cache_schema');
  const handle = database ?? (childRole === 'guard' ? acquireHawdbClearGuard(path, runtime) : openHawdb(path, { readOnly: false, create: false }, runtime));
  const lines = createInterface({ input: process.stdin });
  lines.on('line', command => {
    if (command === 'query') {
      try {
        const rows = database!.querySQL('SELECT cache_key FROM concord_cache_entries WHERE namespace = $1', ['config_cache']).dicts();
        process.stdout.write(JSON.stringify({ rows }) + '\n');
      } catch (cause) {
        process.stdout.write(JSON.stringify({ error: cause instanceof HawDBError ? cause.kind : String(cause) }) + '\n');
      }
    }
  });
  process.stdout.write('READY\n');
  process.on('SIGTERM', () => { handle.close(); library?.close(); lines.close(); process.exit(0); });
} else {
  function fixture() {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'concord-native-')));
    return { dir, path: join(dir, 'cache.hawdb'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }
  function code(operation: () => unknown, expected: HawdbFailureCode): void {
    assert.throws(operation, { code: expected });
  }
  function snapshot(path: string) {
    return [path, ...readdirSync(path, { recursive: true }).map(name => join(path, String(name)))].sort().map(file => {
      const stat = statSync(file, { bigint: true });
      return { file, inode: stat.ino, modified: stat.mtimeNs, digest: stat.isFile() ? createHash('sha256').update(readFileSync(file)).digest('hex') : null };
    });
  }
  function locks(path: string) {
    return readdirSync(path, { recursive: true }).map(String).filter(name => basename(name).endsWith('.lock')).sort().map(name => ({ name, inode: statSync(join(path, name)).ino, parent: statSync(dirname(join(path, name))).ino }));
  }
  function line(proc: ChildProcess): Promise<string> {
    return new Promise((resolve, reject) => {
      let text = '', errors = '';
      const timeout = setTimeout(() => { cleanup(); reject(new Error(`child did not reply: ${errors}`)); }, 15000);
      const onData = (chunk: Buffer) => { text += chunk.toString(); if (text.includes('\n')) { cleanup(); resolve(text.slice(0, text.indexOf('\n'))); } };
      const onErrorData = (chunk: Buffer) => { errors += chunk.toString(); };
      const onExit = (status: number | null) => { cleanup(); reject(new Error(`child exited ${status}: ${errors}`)); };
      const cleanup = () => { clearTimeout(timeout); proc.stdout!.off('data', onData); proc.stderr!.off('data', onErrorData); proc.off('exit', onExit); };
      proc.stdout!.on('data', onData); proc.stderr!.on('data', onErrorData); proc.once('exit', onExit);
    });
  }
  async function stop(proc: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    const exited = once(proc, 'exit'); proc.kill(signal); await exited;
  }
  async function child(role: string, path: string): Promise<ChildProcess> {
    const proc = spawn(process.execPath, [fileURLToPath(import.meta.url)], { cwd: process.cwd(), env: { ...process.env, CONCORD_HAWDB_CHILD_ROLE: role, CONCORD_HAWDB_CHILD_PATH: path }, stdio: ['pipe', 'pipe', 'pipe'] });
    try { assert.equal(await line(proc), 'READY'); return proc; }
    catch (cause) { await stop(proc, 'SIGKILL'); throw cause; }
  }

  // @feature docs/feature/local-data-engine/architecture.md#原生边界
  test('official native identity, parameterized SQL roundtrip, callback rollback and durable close', () => {
    const f = fixture();
    try {
      assert.equal(hawdbIdentity(runtime).version, '0.31.0');
      const database = openHawdb(f.path, { readOnly: false, create: true }, runtime);
      const key = `quote'\"; DROP TABLE x; -- \n Ω`;
      try {
        database.put('code_cache', [{ key, payload: 'value Ω\u0000' }]);
        assert.deepEqual(database.get('code_cache', [key]), [{ key, payload: 'value Ω\u0000' }]);
        const sentinel = new Error('rollback after real SQL writes');
        assert.throws(() => database.atomic(() => {
          database.put('code_cache', [{ key: 'first', payload: '1' }]);
          database.put('config_cache', [{ key: 'second', payload: '2' }]);
          throw sentinel;
        }), error => error === sentinel);
        assert.deepEqual(database.get('code_cache', ['first']), []);
        assert.deepEqual(database.get('config_cache', ['second']), []);
        assert.deepEqual(database.namespaces(), ['annotation_cache', 'code_cache', 'config_cache', 'feedback_cache', 'query_cache', 'workspace_projection']);
      } finally { database.close(); database.close(); }
      code(() => database.get('code_cache', [key]), 'HawdbClosed');
      const reopened = openHawdb(f.path, { readOnly: true, create: false }, runtime);
      try { assert.deepEqual(reopened.get('code_cache', [key]), [{ key, payload: 'value Ω\u0000' }]); }
      finally { reopened.close(); }
    } finally { f.cleanup(); }
  });
  // @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
  test('memory instances isolate rows, enforce namespaces and atomically evict by recent insertion', () => {
    const left = createMemoryHawdb(runtime), right = createMemoryHawdb(runtime);
    try {
      assert.deepEqual(left.namespaces(), ['document_parse', 'code_parse', 'git_baseline']);
      left.put('document_parse', [{ key: 'a', payload: '1' }, { key: 'b', payload: '2' }], { maxEntries: 2, maxBytes: 100 });
      left.put('document_parse', [{ key: 'a', payload: 'new' }], { maxEntries: 2, maxBytes: 100 });
      left.put('document_parse', [{ key: 'c', payload: '3' }], { maxEntries: 2, maxBytes: 100 });
      assert.deepEqual(left.scan('document_parse'), [{ key: 'a', payload: 'new' }, { key: 'c', payload: '3' }]);
      assert.deepEqual(right.scan('document_parse'), []);
      code(() => left.put('document_parse', [{ key: 'too-large', payload: 'x' }], { maxEntries: 1, maxBytes: 1 }), 'HawdbLimit');
      assert.deepEqual(left.scan('document_parse').map(row => row.key), ['a', 'c']);
      code(() => left.put('code_cache', [{ key: 'x', payload: 'y' }]), 'HawdbIncompatible');
      code(() => left.get('document_parse', Array.from({ length: 1001 }, (_, index) => String(index))), 'HawdbLimit');
      left.clearNamespace('document_parse'); assert.deepEqual(left.scan('document_parse'), []);
    } finally { left.close(); right.close(); }
  });
  // @feature docs/feature/local-data-engine/architecture.md#句柄与打开模式
  test('existing-only readonly preserves source files and rejects writes without creating absent storage', () => {
    const f = fixture();
    try {
      code(() => openHawdb(f.path, { readOnly: true, create: false }, runtime), 'HawdbUnavailable');
      assert.equal(existsSync(f.path), false); assert.equal(existsSync(`${f.path}.concord.lock`), false);
      const database = openHawdb(f.path, { readOnly: false, create: true }, runtime);
      database.put('config_cache', [{ key: 'k', payload: 'v' }]); database.close();
      const sources = join(f.dir, 'sources'); mkdirSync(sources);
      for (const name of ['owner.md', 'evidence.json', 'journal.json']) writeFileSync(join(sources, name), 'source-owned bytes');
      const before = snapshot(sources), owner = statSync(join(f.path, 'owner.hawdb.lock')).ino, gate = statSync(`${f.path}.concord.lock`).ino;
      const readonly = openHawdb(f.path, { readOnly: true, create: false }, runtime);
      try {
        code(() => readonly.put('config_cache', [{ key: 'x', payload: 'y' }]), 'HawdbIncompatible');
        assert.deepEqual(readonly.scan('config_cache'), [{ key: 'k', payload: 'v' }]);
      } finally { readonly.close(); }
      assert.deepEqual(snapshot(sources), before); assert.equal(statSync(join(f.path, 'owner.hawdb.lock')).ino, owner); assert.equal(statSync(`${f.path}.concord.lock`).ino, gate);
    } finally { f.cleanup(); }
  });
  // @feature docs/feature/local-data-engine/architecture.md#打开与恢复模式
  test('current SQL schema mismatch preserves files and requires explicit guarded clear', () => {
    const f = fixture();
    try {
      const database = openHawdb(f.path, { readOnly: false, create: true }, runtime);
      database.sql('DELETE FROM concord_cache_schema WHERE version = $1', ['concord.cache/v2']); database.sql('INSERT INTO concord_cache_schema (version) VALUES ($1)', ['not-concord']); database.close();
      for (const readOnly of [true, false]) code(() => openHawdb(f.path, { readOnly, create: false }, runtime), 'HawdbIncompatible');
      const beforeLocks = locks(f.path);
      const guard = acquireHawdbClearGuard(f.path, runtime);
      try { deleteInspectedCache(inspectCacheClear(f.dir), guard.verify); assert.deepEqual(locks(f.path), beforeLocks); }
      finally { guard.close(); }
      assert.equal(inspectCacheClear(f.dir).empty, true);
      const rebuilt = openHawdb(f.path, { readOnly: false, create: true }, runtime);
      try { assert.deepEqual(rebuilt.scan('config_cache'), []); }
      finally { rebuilt.close(); }
    } finally { f.cleanup(); }
  });
  // @feature docs/feature/local-data-engine/architecture.md#锁
  test('cross-process owner and clear guard exclude both directions and preserve ownership lock inodes', async () => {
    const f = fixture(); let proc: ChildProcess | undefined;
    try {
      openHawdb(f.path, { readOnly: false, create: true }, runtime).close();
      const owner = statSync(join(f.path, 'owner.hawdb.lock')).ino, gate = statSync(`${f.path}.concord.lock`).ino;
      proc = await child('database', f.path); code(() => acquireHawdbClearGuard(f.path, runtime), 'HawdbBusy');
      await stop(proc); proc = undefined;
      proc = await child('guard', f.path); code(() => openHawdb(f.path, { readOnly: false, create: false }, runtime), 'HawdbBusy');
      await stop(proc); proc = undefined;
      openHawdb(f.path, { readOnly: false, create: false }, runtime).close();
      assert.equal(statSync(join(f.path, 'owner.hawdb.lock')).ino, owner); assert.equal(statSync(`${f.path}.concord.lock`).ino, gate);
    } finally { if (proc) await stop(proc, 'SIGKILL'); f.cleanup(); }
  });
  // @feature docs/feature/local-data-engine/architecture.md#清理
  test('clear refuses active official external branches and fences a lazy handle before and after deletion', async () => {
    const f = fixture(); let proc: ChildProcess | undefined, deferred: ChildProcess | undefined;
    try {
      const database = openHawdb(f.path, { readOnly: false, create: true }, runtime);
      database.put('config_cache', [{ key: 'old-generation', payload: 'retained until clear' }]); database.close();
      const before = snapshot(f.path);
      proc = await child('official-active', f.path);
      code(() => acquireHawdbClearGuard(f.path, runtime), 'HawdbBusy');
      await stop(proc); proc = undefined;
      // External admission may rebuild runtime files, but the committed row must survive a refused clear.
      const retained = openHawdb(f.path, { readOnly: true, create: false }, runtime);
      try { assert.deepEqual(retained.get('config_cache', ['old-generation']), [{ key: 'old-generation', payload: 'retained until clear' }]); }
      finally { retained.close(); }
      assert.ok(before.length > 1);
      proc = await child('official-lazy', f.path);
      deferred = await child('official-lazy', f.path);
      const beforeLocks = locks(f.path), guard = acquireHawdbClearGuard(f.path, runtime);
      try {
        const reply = line(proc); proc.stdin!.write('query\n');
        assert.ok('error' in JSON.parse(await reply), 'lazy external admission must fail while clear holds engine leases');
        deleteInspectedCache(inspectCacheClear(f.dir), guard.verify);
        assert.deepEqual(locks(f.path), beforeLocks); assert.equal(inspectCacheClear(f.dir).empty, true);
      } finally { guard.close(); }
      const rebuilt = openHawdb(f.path, { readOnly: false, create: true }, runtime);
      try {
        rebuilt.put('config_cache', [{ key: 'new-generation', payload: 'current' }]);
        const reply = line(proc); proc.stdin!.write('query\n');
        assert.ok('error' in JSON.parse(await reply), 'a lazy stale selector must not read a deleted generation while a new owner is active');
        assert.deepEqual(rebuilt.scan('config_cache'), [{ key: 'new-generation', payload: 'current' }]);
      } finally { rebuilt.close(); }
      const reply = line(deferred); deferred.stdin!.write('query\n');
      const observation = JSON.parse(await reply) as { rows?: readonly { cache_key: string }[]; error?: string };
      if (observation.rows) assert.deepEqual(observation.rows, [{ cache_key: 'new-generation' }], 'an untouched lazy handle may only re-admit into the new generation');
      else assert.ok(observation.error, 'a stale selector must fail explicitly');
      await stop(deferred); deferred = undefined;
      await stop(proc); proc = undefined;
    } finally { if (proc) await stop(proc, 'SIGKILL'); if (deferred) await stop(deferred, 'SIGKILL'); f.cleanup(); }
  });
  // @feature docs/feature/local-data-engine/architecture.md#清理
  test('clear preserves nested lock inodes and refuses external aliases, linked locks and symlinks', () => {
    const f = fixture();
    try {
      openHawdb(f.path, { readOnly: false, create: true }, runtime).close();
      mkdirSync(join(f.path, 'left')); mkdirSync(join(f.path, 'right'));
      const inside = join(f.path, 'left/data'), alias = join(f.path, 'right/alias'), outside = join(f.dir, 'outside');
      writeFileSync(inside, 'shared internal bytes'); linkSync(inside, alias);
      acquireHawdbClearGuard(f.path, runtime).close();
      linkSync(inside, outside); code(() => acquireHawdbClearGuard(f.path, runtime), 'UnsafePath'); rmSync(outside);
      linkSync(join(f.path, 'owner.hawdb.lock'), outside); code(() => acquireHawdbClearGuard(f.path, runtime), 'UnsafePath'); rmSync(outside);
      symlinkSync(inside, outside); code(() => acquireHawdbClearGuard(outside, runtime), 'UnsafePath'); rmSync(outside);
      const beforeLocks = locks(f.path), guard = acquireHawdbClearGuard(f.path, runtime);
      try { deleteInspectedCache(inspectCacheClear(f.dir), guard.verify); assert.deepEqual(locks(f.path), beforeLocks); }
      finally { guard.close(); }
      assert.equal(existsSync(inside), false); assert.equal(existsSync(alias), false);
    } finally { f.cleanup(); }
  });
  // @feature docs/feature/local-data-engine/architecture.md#事务与提交结果
  test('SIGKILL inside an official synchronous transaction never publishes a partial batch', async () => {
    const f = fixture(); let proc: ChildProcess | undefined;
    try {
      const database = openHawdb(f.path, { readOnly: false, create: true }, runtime);
      database.put('config_cache', [{ key: 'committed', payload: 'survives' }]); database.close();
      proc = await child('transaction', f.path); await stop(proc, 'SIGKILL'); proc = undefined;
      const reopened = openHawdb(f.path, { readOnly: false, create: false }, runtime);
      try { assert.deepEqual(reopened.scan('code_cache'), []); assert.deepEqual(reopened.scan('config_cache'), [{ key: 'committed', payload: 'survives' }]); }
      finally { reopened.close(); }
    } finally { if (proc) await stop(proc, 'SIGKILL'); f.cleanup(); }
  });
  // @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
  test('verified official artifact rejects private corruption and retries an atomically repaired image', () => {
    const f = fixture();
    try {
      const cache = join(f.dir, 'cache'), privateRuntime = makeRuntimeEnvironment(process.cwd(), { ...process.env, XDG_CACHE_HOME: cache });
      const folder = join(nativeCacheRoot(privateRuntime), hawdbTarget());
      cpSync(join(nativeArtifactRoot(runtime), hawdbTarget()), folder, { recursive: true });
      const binary = join(folder, relative(join(nativeArtifactRoot(runtime), hawdbTarget()), verifiedHawdbLibrary(runtime).binary)), original = join(f.dir, 'original');
      writeFileSync(original, readFileSync(binary)); writeFileSync(binary, Buffer.concat([readFileSync(binary), Buffer.from('digest mismatch')]));
      const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, XDG_CACHE_HOME: cache, CONCORD_HAWDB_CHILD_ROLE: 'repair', CONCORD_HAWDB_CHILD_BINARY: binary, CONCORD_HAWDB_CHILD_ORIGINAL: original }, encoding: 'utf8', timeout: 30000 });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    } finally { f.cleanup(); }
  });
}
