import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, Layer } from 'effect';
import { PersistentCache, openHawdb, acquireHawdbClearGuard } from '../../src/base/cache/index.ts';
import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { Workspace, WorkspaceContext } from '../../src/base/workspace/index.ts';
import { Sources } from '../../src/base/sources/index.ts';
import { createConsumer } from '../support/consumer.ts';

const live = Layer.mergeAll(PersistentCache.layer, Workspace.layer, Sources.layer).pipe(Layer.provide(NodeServices.layer));
const prepare = (root: string, missing: boolean) => {
  const privateDir = join(root, '.git/concord'), path = join(privateDir, 'cache.hawdb');
  const runtime = makeRuntimeEnvironment(root, process.env);
  const database = openHawdb(path, { create: true, readOnly: false }, runtime);
  try { database.put('config_cache', [{ key: 'obsolete', payload: 'discard me' }]); } finally { database.close(); }
  const identity = readFileSync(join(path, 'concord.identity'), 'utf8');
  if (missing) unlinkSync(join(path, 'concord.identity'));
  else writeFileSync(join(path, 'concord.identity'), 'incompatible format');
  return { privateDir, path, runtime, identity };
};

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md#hit
test('the workspace persistent owner rebuilds missing and incompatible cache identities', async () => {
  for (const missing of [true, false]) {
    const root = createConsumer();
    try {
      const f = prepare(root, missing);
      await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
        const owner = yield* PersistentCache.owner(f.privateDir);
        yield* owner.open;
        assert.deepEqual((yield* owner.snapshot).config_cache, []);
        assert.equal(readFileSync(join(f.path, 'concord.identity'), 'utf8'), f.identity);
      })).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, f.runtime)));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md#hit
test('source snapshot writes rebuild incompatible cache identities while readonly opens preserve them', async () => {
  for (const missing of [true, false]) {
    const root = createConsumer();
    try {
      const f = prepare(root, missing);
      await Effect.runPromise(Effect.gen(function*() {
        const sources = yield* Sources, cache = yield* PersistentCache;
        const context = yield* (yield* Workspace).open(root, { access: 'read', cache: 'use' });
        const read = yield* sources.snapshot(cache.read(f.privateDir, 'config_cache')).pipe(Effect.provideService(WorkspaceContext, context), Effect.result);
        assert.equal(read._tag, 'Failure');
        if (read._tag === 'Failure') assert.equal(read.failure.code, 'HawdbIncompatible');
        assert.equal(existsSync(join(f.path, 'concord.identity')), !missing);
        yield* sources.snapshot(cache.update(f.privateDir, 'config_cache', 'current', () => 'rebuilt')).pipe(Effect.provideService(WorkspaceContext, context));
        const rows = yield* sources.snapshot(cache.read(f.privateDir, 'config_cache')).pipe(Effect.provideService(WorkspaceContext, context));
        assert.deepEqual(rows.map(row => ({ key: row.key, payload: row.payload })), [{ key: 'current', payload: 'rebuilt' }]);
        assert.equal(readFileSync(join(f.path, 'concord.identity'), 'utf8'), f.identity);
      }).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, f.runtime)));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// @feature docs/feature/local-data-engine/architecture.md#句柄与打开模式
test('cache rebuild refuses another clear owner and preserves the incompatible directory', async () => {
  const root = createConsumer();
  try {
    const f = prepare(root, false);
    const guard = acquireHawdbClearGuard(f.path, f.runtime);
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
        const owner = yield* PersistentCache.owner(f.privateDir);
        const result = yield* Effect.result(owner.open);
        assert.equal(result._tag, 'Failure');
        if (result._tag === 'Failure') assert.equal(result.failure.code, 'HawdbBusy');
        assert.equal(readFileSync(join(f.path, 'concord.identity'), 'utf8'), 'incompatible format');
      })).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, f.runtime)));
    } finally { guard.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/architecture.md#句柄与打开模式
test('source snapshot aggregate caches fall back on contention without pretending historical observations exist', async () => {
  const root = createConsumer();
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
