import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { makePersistentCacheOwner, PersistentCache } from '../../src/base/cache/index.ts';
import { makeRuntimeEnvironment, RuntimeEnvironment } from '../../src/base/environment/index.ts';
import { tmpdir } from '../support/temporary.ts';

// @feature docs/feature/local-data-engine/architecture.md#状态
// @issue docs/issues/native-open-blocks-service.md
test('persistent owner opening and closing allow the service event loop to run', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'concord-owner-lifecycle-'));
  const runtime = makeRuntimeEnvironment(process.cwd(), process.env);
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const owner = yield* makePersistentCacheOwner(directory);
      let openingTurn = false;
      const openingTimer = setTimeout(() => { openingTurn = true; }, 0);
      try {
        yield* owner.open;
        assert.equal(openingTurn, true, 'cold persistent open must yield the JS event loop');
      } finally { clearTimeout(openingTimer); }
      let closingTurn = false;
      const closingTimer = setTimeout(() => { closingTurn = true; }, 0);
      try {
        yield* owner.close;
        assert.equal(closingTurn, true, 'persistent close must yield the JS event loop');
      } finally { clearTimeout(closingTimer); }
    })).pipe(Effect.provide(PersistentCache.layer), Effect.provideService(RuntimeEnvironment, runtime)));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/architecture.md#协调锁
test('interrupting persistent owner acquisition releases the late native handle', async () => {
  const { Fiber } = await import('effect');
  const { acquireHawdbClearGuard } = await import('../../src/base/cache/index.ts');
  const directory = mkdtempSync(join(tmpdir(), 'concord-owner-interrupt-'));
  const runtime = makeRuntimeEnvironment(process.cwd(), process.env);
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const owner = yield* makePersistentCacheOwner(directory);
      const opening = yield* Effect.forkChild(owner.open);
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(opening);
      const guard = acquireHawdbClearGuard(join(directory, 'cache.hawdb'), runtime);
      guard.close();
      yield* owner.open;
      yield* owner.close;
    })).pipe(Effect.provide(PersistentCache.layer), Effect.provideService(RuntimeEnvironment, runtime)));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/architecture.md#协调锁
test('concurrent persistent owner closes both wait for native lock release', async () => {
  const { acquireHawdbClearGuard } = await import('../../src/base/cache/index.ts');
  const directory = mkdtempSync(join(tmpdir(), 'concord-owner-closing-'));
  const runtime = makeRuntimeEnvironment(process.cwd(), process.env);
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const owner = yield* makePersistentCacheOwner(directory);
      yield* owner.open;
      yield* Effect.promise(async () => {
        const first = Effect.runPromise(owner.close);
        try {
          await Effect.runPromise(owner.close);
          const guard = acquireHawdbClearGuard(join(directory, 'cache.hawdb'), runtime);
          guard.close();
        } finally { await first; }
      });
      yield* owner.open;
    })).pipe(Effect.provide(PersistentCache.layer), Effect.provideService(RuntimeEnvironment, runtime)));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
