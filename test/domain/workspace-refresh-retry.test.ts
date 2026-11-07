import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { ConcordError } from '../../src/model/index.ts';
import { makeWorkspaceService } from '../../src/entry/server/service.ts';
import { ports, record, stateLayer } from '../support/workspace-service-fixture.ts';

for (const [code, delay] of [['RepositoryBusy', 100], ['SourceChanged', 1000]] as const) {
  // @feature docs/feature/local-data-engine/architecture.md#刷新与推送
  test(`workspace refresh retries ${code} after the failed operation scope closes`, () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    let scans = 0;
    const service = yield* makeWorkspaceService(ports({
      compute: () => Effect.suspend(() => ++scans === 1 ? Effect.fail(new ConcordError(code, 'Source is temporarily unavailable')) : Effect.succeed(record)),
    }));
    yield* TestClock.adjust(0);
    assert.equal(scans, 1);
    yield* TestClock.adjust(delay - 1);
    assert.equal(scans, 1, 'the failed attempt does not retry before its delay');
    yield* TestClock.adjust(1);
    assert.equal(scans, 2, 'the service keeps the retry alive after releasing the failed refresh operation');
    yield* service.stop;
  })).pipe(Effect.provide(stateLayer))));
}
