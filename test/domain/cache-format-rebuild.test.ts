import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, Layer } from 'effect';
import { PersistentCache, openHawdb, acquireHawdbClearGuard, HawdbFailure } from '../../src/base/cache/index.ts';
import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { Workspace, WorkspaceContext } from '../../src/base/workspace/index.ts';
import { Sources } from '../../src/base/sources/index.ts';
import { verifiedHawdbLibrary } from '../../src/base/installation/index.ts';
import { loadHawDB } from '@nowledge/hawdb-bun';
import { createConsumer } from '../support/consumer.ts';

const live = Layer.mergeAll(PersistentCache.layer, Workspace.layer, Sources.layer).pipe(Layer.provide(NodeServices.layer));
const prepare = (root: string, missing: boolean) => {
  const privateDir = join(root, '.git/concord'), path = join(privateDir, 'cache.hawdb');
  const runtime = makeRuntimeEnvironment(root, process.env);
  const database = openHawdb(path, { create: true, readOnly: false }, runtime);
  try {
    database.put('config_cache', [{ key: 'retained', payload: 'preserve until explicit clear' }]);
    database.atomic(() => {
      database.sql('DELETE FROM concord_cache_schema WHERE version = $1', ['concord.cache/v2']);
      if (!missing) database.sql('INSERT INTO concord_cache_schema (version) VALUES ($1)', ['incompatible format']);
    });
  } finally { database.close(); }
  const evidence = join(path, 'preserve-evidence');
  writeFileSync(evidence, 'preserve until explicit clear');
  return { privateDir, path, runtime, evidence };
};
const assertPreserved = (fixture: ReturnType<typeof prepare>) => {
  assert.equal(readFileSync(fixture.evidence, 'utf8'), 'preserve until explicit clear');
  const library = loadHawDB(verifiedHawdbLibrary(fixture.runtime).binary);
  try {
    const database = library.open(fixture.path, { readOnly: true });
    try {
      const rows = database.querySQL('SELECT payload FROM concord_cache_entries WHERE namespace = $1 AND cache_key = $2', ['config_cache', 'retained']).dicts();
      assert.equal(rows.length, 1);
      const payload = rows[0]?.payload;
      assert.ok(payload instanceof Uint8Array);
      assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(payload), 'preserve until explicit clear');
    } finally { database.close(); }
  } finally { library.close(); }
};

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md#hit
test('the workspace owner preserves missing or incompatible schemas until explicit clear', async () => {
  for (const missing of [true, false]) {
    const root = (await createConsumer());
    try {
      const f = prepare(root, missing);
      await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
        const owner = yield* PersistentCache.owner(f.privateDir);
        const opened = yield* Effect.result(owner.open);
        assert.equal(opened._tag, 'Failure');
        if (opened._tag === 'Failure') assert.equal(opened.failure.code, 'HawdbIncompatible');
        const snapshot = yield* Effect.result(owner.snapshot);
        assert.equal(snapshot._tag, 'Failure', 'an incompatible database cannot supply a valid empty observation');
        assertPreserved(f);
        yield* owner.clear;
        assert.deepEqual((yield* owner.snapshot).config_cache, []);
        assert.equal(existsSync(f.evidence), false, 'only explicit clear discards the preserved database');
      })).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, f.runtime)));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md#hit
test('source snapshot reads and writes reject incompatible schemas without deleting data', async () => {
  for (const missing of [true, false]) {
    const root = (await createConsumer());
    try {
      const f = prepare(root, missing);
      await Effect.runPromise(Effect.gen(function*() {
        const sources = yield* Sources, cache = yield* PersistentCache;
        const context = yield* (yield* Workspace).open(root, { access: 'read', cache: 'use' });
        const read = yield* sources.snapshot(cache.read(f.privateDir, 'config_cache')).pipe(Effect.provideService(WorkspaceContext, context), Effect.result);
        assert.equal(read._tag, 'Failure');
        if (read._tag === 'Failure') assert.equal(read.failure.code, 'HawdbIncompatible');
        let computed = false;
        const write = yield* sources.snapshot(cache.update(f.privateDir, 'config_cache', 'current', () => { computed = true; return 'rebuilt'; })).pipe(Effect.provideService(WorkspaceContext, context), Effect.result);
        assert.equal(write._tag, 'Failure');
        if (write._tag === 'Failure') assert.equal(write.failure.code, 'HawdbIncompatible');
        assert.equal(computed, false, 'an inadmissible persistent write cannot run its update callback');
        assertPreserved(f);
      }).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, f.runtime)));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// @feature docs/feature/local-data-engine/architecture.md#句柄与打开模式
test('explicit clear refuses another clear owner and preserves the incompatible directory', async () => {
  const root = (await createConsumer());
  try {
    const f = prepare(root, false);
    const guard = acquireHawdbClearGuard(f.path, f.runtime);
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
        const owner = yield* PersistentCache.owner(f.privateDir);
        const result = yield* Effect.result(owner.open);
        assert.equal(result._tag, 'Failure');
        if (result._tag === 'Failure') assert.equal(result.failure.code, 'HawdbBusy');
        const clearing = yield* Effect.result(owner.clear);
        assert.equal(clearing._tag, 'Failure');
        if (clearing._tag === 'Failure') {
          assert.ok(clearing.failure instanceof HawdbFailure);
          assert.equal(clearing.failure.code, 'HawdbBusy');
        }
        assert.equal(readFileSync(f.evidence, 'utf8'), 'preserve until explicit clear');
      })).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, f.runtime)));
    } finally { guard.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/architecture.md#句柄与打开模式
test('source snapshot aggregate caches fall back on contention without pretending historical observations exist', async () => {
  const root = (await createConsumer());
  try {
    const privateDir = join(root, '.git/concord');
    const runtime = makeRuntimeEnvironment(root, process.env);
    const held = openHawdb(join(privateDir, 'cache.hawdb'), { create: true, readOnly: false }, runtime);
    try {
      held.put('config_cache', [{ key: 'owner', payload: 'retained' }]);
      await Effect.runPromise(Effect.gen(function*() {
        const sources = yield* Sources, cache = yield* PersistentCache;
        const context = yield* (yield* Workspace).open(root, { access: 'read', cache: 'use' });
        yield* sources.snapshot(Effect.gen(function*() {
          assert.deepEqual(yield* cache.read(privateDir, 'config_cache'), []);
          yield* cache.update(privateDir, 'config_cache', 'local', () => 'recomputed');
          const historical = yield* Effect.result(cache.read(privateDir, 'feedback_cache'));
          assert.equal(historical._tag, 'Failure');
          if (historical._tag === 'Failure') assert.equal(historical.failure.code, 'HawdbBusy');
        })).pipe(Effect.provideService(WorkspaceContext, context));
      }).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, runtime)));
      assert.deepEqual(held.get('config_cache', ['local']), []);
      assert.equal(held.get('config_cache', ['owner'])[0]?.payload, 'retained');
    } finally { held.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
