import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { makeHttpLeases } from '../../src/entry/server/index.js';

// @feature docs/feature/web-workbench/README.md
// @issue docs/issues/workspace-server-unimplemented.md
test('HTTP leases share a listener, retain SSE across owner disconnect and close after the last connection', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  let started = 0, closed = 0;
  let sse: (delta: number) => void = () => {};
  const leases = yield* makeHttpLeases('instance', (_host, _port, connected) => Effect.sync(() => {
    started++; sse = connected;
    return { host: '127.0.0.1', port: 4317, address: 'http://127.0.0.1:4317/', close: async () => { closed++; } };
  }));
  yield* leases.open('127.0.0.1', 0, false, 1);
  yield* leases.open('127.0.0.1', 0, false, 2);
  assert.equal(started, 1);
  sse(1);
  yield* leases.disconnect(1); yield* leases.disconnect(2);
  assert.equal(closed, 0);
  sse(-1);
  yield* TestClock.adjust(0);
  yield* leases.tick;
  assert.equal(closed, 1);
})).pipe(Effect.provide(TestClock.layer()))));

// @feature docs/feature/web-workbench/README.md
test('panel HTTP leases survive panel disconnect, expire after ten SSE-free minutes and reject another token', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  let closed = 0;
  const leases = yield* makeHttpLeases('instance', () => Effect.succeed({ host: '127.0.0.1', port: 4317, address: 'http://127.0.0.1:4317/', close: async () => { closed++; } }));
  const opened = yield* leases.open('127.0.0.1', 0, true, 1);
  yield* leases.disconnect(1);
  yield* TestClock.adjust(599_999); yield* leases.tick;
  assert.equal(closed, 0);
  const wrong = yield* Effect.result(leases.close(`different:${opened.lease}`));
  assert.equal(wrong._tag, 'Failure');
  yield* TestClock.adjust(1); yield* leases.tick;
  assert.equal(closed, 1);
})).pipe(Effect.provide(TestClock.layer()))));
