import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Layer } from 'effect';
import { NodeServices } from '@effect/platform-node';
import { loadHawDB } from '@nowledge/hawdb-bun';
import { CacheSchemaMismatch, PersistentCache, acquireHawdbClearGuard, deleteInspectedCache, inspectCacheClear, openHawdb, verifyCacheSchemaIdentity } from '../../src/base/cache/index.ts';
import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { verifiedHawdbLibrary } from '../../src/base/installation/index.ts';
import { createConsumer } from '../support/consumer.ts';

// @feature docs/feature/local-data-engine/architecture.md#cache-schema-invalidation
test('the persistent owner automatically rebuilds real unsupported row-page v1 storage', async () => {
  const root = await createConsumer();
  const privateDir = join(root, '.git/concord'), path = join(privateDir, 'cache.hawdb');
  const runtime = makeRuntimeEnvironment(root, process.env);
  try {
    mkdirSync(path, { recursive: true });
    execFileSync('tar', ['-xzf', new URL('../fixtures/hawdb/row-page-v1.tar.gz', import.meta.url).pathname, '-C', path]);
    const source = join(root, 'docs/taste.md'), before = readFileSync(source, 'utf8');
    const lock = join(path, 'owner.hawdb.lock'), inode = statSync(lock, { bigint: true }).ino;
    assert.throws(() => openHawdb(path, { create: false, readOnly: true }, runtime), /unsupported_storage_format.*version 1/u);
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const owner = yield* PersistentCache.owner(privateDir);
      yield* owner.open;
      assert.equal((yield* owner.status).status, 'ready');
      assert.deepEqual((yield* owner.snapshot).config_cache, []);
    })).pipe(Effect.provide(PersistentCache.layer.pipe(Layer.provide(NodeServices.layer))), Effect.provideService(RuntimeEnvironment, runtime)));
    assert.equal(statSync(lock, { bigint: true }).ino, inode);
    assert.equal(readFileSync(source, 'utf8'), before);
    const reopened = openHawdb(path, { create: false, readOnly: true }, runtime);
    reopened.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

async function fixture() {
  const root = await createConsumer();
  const privateDir = join(root, '.git/concord'), path = join(privateDir, 'cache.hawdb');
  const runtime = makeRuntimeEnvironment(root, process.env);
  const database = openHawdb(path, { create: true, readOnly: false }, runtime);
  try {
    database.put('config_cache', [{ key: 'obsolete', payload: 'old cached value' }]);
    database.sql('UPDATE concord_cache_schema SET version = $1 WHERE version = $2', ['concord.cache/v1', 'concord.cache/v2']);
  } finally { database.close(); }
  return { root, privateDir, path, runtime };
}

// @feature docs/feature/local-data-engine/architecture.md#cache-schema-invalidation
test('the persistent owner rebuilds a confirmed obsolete schema once, preserving source and lock identities', async () => {
  const f = await fixture();
  try {
    const source = join(f.root, 'docs/taste.md'), before = readFileSync(source, 'utf8');
    const lock = join(f.path, 'owner.hawdb.lock'), inode = statSync(lock, { bigint: true }).ino;
    assert.throws(() => openHawdb(f.path, { create: false, readOnly: true }, f.runtime), { code: 'HawdbCacheSchemaMismatch' });
    const live = PersistentCache.layer.pipe(Layer.provide(NodeServices.layer));
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const owner = yield* PersistentCache.owner(f.privateDir);
      yield* owner.open;
      assert.deepEqual((yield* owner.snapshot).config_cache, []);
      yield* owner.close;
      yield* owner.open;
      assert.equal((yield* owner.status).status, 'ready');
    })).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, f.runtime)));
    assert.equal(readFileSync(source, 'utf8'), before);
    assert.equal(statSync(lock, { bigint: true }).ino, inode);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/architecture.md#cache-schema-invalidation
test('a schema observation cannot authorize clearing a cache changed by an external official opener', async () => {
  const f = await fixture();
  try {
    let observation: string | undefined;
    assert.throws(() => openHawdb(f.path, { create: false, readOnly: false }, f.runtime), error => {
      assert.ok(error instanceof CacheSchemaMismatch); observation = error.observation; return true;
    });
    const library = loadHawDB(verifiedHawdbLibrary(f.runtime).binary);
    try {
      const database = library.open(f.path);
      try { database.querySQL('UPDATE concord_cache_schema SET version = $1 WHERE version = $2', ['concord.cache/v2', 'concord.cache/v1']); }
      finally { database.close(); }
    } finally { library.close(); }
    const guard = acquireHawdbClearGuard(f.path, f.runtime);
    try { assert.throws(() => verifyCacheSchemaIdentity(f.path, observation!), { code: 'UnsafePath' }); }
    finally { guard.close(); }
    const current = openHawdb(f.path, { create: false, readOnly: true }, f.runtime);
    try { assert.equal(current.get('config_cache', ['obsolete'])[0]?.payload, 'old cached value'); }
    finally { current.close(); }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/architecture.md#cache-schema-invalidation
test('same-size tree changes also invalidate schema evidence', async () => {
  const f = await fixture();
  try {
    const evidence = join(f.path, 'sentinel'); writeFileSync(evidence, 'before');
    let observation: string | undefined;
    assert.throws(() => openHawdb(f.path, { create: false, readOnly: false }, f.runtime), error => {
      assert.ok(error instanceof CacheSchemaMismatch); observation = error.observation; return true;
    });
    writeFileSync(evidence, 'after!');
    const guard = acquireHawdbClearGuard(f.path, f.runtime);
    try { assert.throws(() => verifyCacheSchemaIdentity(f.path, observation!), { code: 'UnsafePath' }); }
    finally { guard.close(); }
    assert.equal(readFileSync(evidence, 'utf8'), 'after!');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/architecture.md#cache-schema-invalidation
test('root pin normalization does not hide other files, path changes, aliases or directory replacement', async () => {
  for (const mutation of ['same-name', 'other-pin-file', 'new-pending', 'symlink', 'hardlink', 'directory'] as const) {
    const f = await fixture();
    try {
      const branch = readdirSync(join(f.path, 'branches')).find(name => /^[0-9a-f-]{36}$/.test(name))!;
      const pins = join(f.path, 'branches', branch, 'root-pins');
      const roots = join(pins, 'roots.hawdb');
      const other = mutation === 'same-name' ? join(f.path, 'roots.hawdb') : join(pins, 'other');
      if (mutation === 'same-name' || mutation === 'other-pin-file') writeFileSync(other, 'before');
      let observation: string | undefined;
      assert.throws(() => openHawdb(f.path, { create: false, readOnly: false }, f.runtime), error => {
        assert.ok(error instanceof CacheSchemaMismatch); observation = error.observation; return true;
      });
      if (mutation === 'same-name' || mutation === 'other-pin-file') writeFileSync(other, 'after!');
      if (mutation === 'new-pending') writeFileSync(join(pins, 'roots.pending'), 'new');
      if (mutation === 'symlink') { rmSync(roots); symlinkSync(join(f.root, 'docs/taste.md'), roots); }
      if (mutation === 'hardlink') linkSync(roots, join(f.root, 'external-pin'));
      if (mutation === 'directory') {
        const previous = join(f.root, 'old-pins');
        renameSync(pins, previous); mkdirSync(pins);
        for (const name of readdirSync(previous)) renameSync(join(previous, name), join(pins, name));
        rmSync(previous, { recursive: true });
      }
      assert.throws(() => verifyCacheSchemaIdentity(f.path, observation!), { code: 'UnsafePath' }, mutation);
      assert.ok(statSync(f.path).isDirectory());
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

// @feature docs/feature/local-data-engine/architecture.md#failure-propagation
test('a malformed schema stays intact until explicit clear, including after the failed Worker closes', async () => {
  const f = await fixture();
  try {
    const library = loadHawDB(verifiedHawdbLibrary(f.runtime).binary);
    try {
      const database = library.open(f.path);
      try { database.querySQL('UPDATE concord_cache_schema SET version = $1 WHERE version = $2', ['broken', 'concord.cache/v1']); }
      finally { database.close(); }
    } finally { library.close(); }
    const live = PersistentCache.layer.pipe(Layer.provide(NodeServices.layer));
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const owner = yield* PersistentCache.owner(f.privateDir);
      const opened = yield* Effect.result(owner.open);
      assert.equal(opened._tag, 'Failure');
      if (opened._tag === 'Failure') assert.equal(opened.failure.code, 'HawdbIncompatible');
      yield* owner.close;
      const status = yield* owner.status;
      assert.equal(status.status, 'unavailable');
      assert.match(status.detail ?? '', /HawdbIncompatible/);
      assert.equal((yield* owner.clear).status, 'cleared');
      assert.deepEqual((yield* owner.snapshot).config_cache, []);
    })).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, f.runtime)));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/architecture.md#cache-schema-invalidation
test('schema invalidation deletion preserves every engine lock before native reopening', async () => {
  const f = await fixture();
  try {
    let observation: string | undefined;
    assert.throws(() => openHawdb(f.path, { create: false, readOnly: false }, f.runtime), error => {
      assert.ok(error instanceof CacheSchemaMismatch); observation = error.observation; return true;
    });
    const guard = acquireHawdbClearGuard(f.path, f.runtime);
    try {
      const locks = readdirSync(f.path, { recursive: true, encoding: 'utf8' }).filter(name => name.endsWith('.lock')).map(name => ({ name, inode: statSync(join(f.path, name), { bigint: true }).ino }));
      verifyCacheSchemaIdentity(f.path, observation!);
      deleteInspectedCache(inspectCacheClear(f.privateDir), guard.verify);
      for (const lock of locks) assert.equal(statSync(join(f.path, lock.name), { bigint: true }).ino, lock.inode, lock.name);
    } finally { guard.close(); }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
