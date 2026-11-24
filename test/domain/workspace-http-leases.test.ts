import assert from 'node:assert/strict';
import { get } from 'node:http';
import test from 'node:test';
import { Deferred, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { startHostedViewServer } from '../../src/entry/http/index.ts';
import { makeHttpLeases } from '../../src/entry/server/http-leases.ts';

// @feature docs/feature/web-workbench/README.md
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

// @spec docs/feature/web-workbench/architecture.md#服务托管
test('queued SSE cleanup for a closed listener preserves a newer listener at the same address', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const otherStartEntered = yield* Deferred.make<void>();
  const releaseOtherStart = yield* Deferred.make<void>();
  let started = 0;
  let sse: (delta: number) => void = () => {};
  const closed = new Set<number>();
  const leases = yield* makeHttpLeases('instance', (host, port, connected) => Effect.gen(function*() {
    if (port === 4318) {
      yield* Deferred.succeed(otherStartEntered, undefined);
      yield* Deferred.await(releaseOtherStart);
    } else {
      sse = connected;
      started++;
    }
    const actualPort = port || 4318 + started;
    return { host, port: actualPort, address: `http://${host}:${actualPort}/`, close: async () => { closed.add(actualPort); } };
  }));
  const first = yield* leases.open('127.0.0.1', 0, false, 1);
  sse(1);
  yield* leases.disconnect(1);
  const other = yield* leases.open('127.0.0.1', 4318, false, 2).pipe(Effect.forkChild({ startImmediately: true }));
  yield* Deferred.await(otherStartEntered);
  const tick = yield* leases.tick.pipe(Effect.forkChild({ startImmediately: true }));
  const reopen = yield* leases.open('127.0.0.1', 0, false, 2).pipe(Effect.forkChild({ startImmediately: true }));
  sse(-1);
  yield* Deferred.succeed(releaseOtherStart, undefined);
  yield* Fiber.join(other);
  yield* Fiber.join(tick);
  const second = yield* Fiber.join(reopen);
  assert.ok(closed.has(first.port));
  const shared = yield* leases.open('127.0.0.1', 0, false, 3);
  assert.equal(shared.port, second.port, 'the reopened listener must still be shared');
  yield* leases.close(second.lease);
  assert.ok(!closed.has(second.port));
  yield* leases.close(shared.lease);
  assert.ok(closed.has(second.port));
}))));

// @spec docs/feature/web-workbench/architecture.md#服务托管
test('a panel gets ten SSE-free minutes from acquiring its own reference on an existing listener', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  let closed = false;
  const leases = yield* makeHttpLeases('instance', (host, port) => Effect.succeed({ host, port, address: `http://${host}:${port}/`, close: async () => { closed = true; } }));
  const view = yield* leases.open('127.0.0.1', 4317, false, 1);
  yield* TestClock.adjust(600_000);
  yield* leases.open('127.0.0.1', 4317, true, 2);
  yield* leases.close(view.lease);
  yield* TestClock.adjust(599_999);
  yield* leases.tick;
  assert.equal(closed, false);
  yield* TestClock.adjust(1);
  yield* leases.tick;
  assert.equal(closed, true);
})).pipe(Effect.provide(TestClock.layer()))));

// @spec docs/feature/web-workbench/architecture.md#服务托管
test('the last SSE disconnect starts a new ten-minute idle period for a panel reference', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  let closed = false;
  let sse: (delta: number) => void = () => {};
  const leases = yield* makeHttpLeases('instance', (host, port, connected) => Effect.sync(() => {
    sse = connected;
    return { host, port, address: `http://${host}:${port}/`, close: async () => { closed = true; } };
  }));
  yield* leases.open('127.0.0.1', 4317, true, 1);
  sse(1);
  yield* TestClock.adjust(600_000);
  yield* leases.tick;
  assert.equal(closed, false);
  sse(-1);
  yield* TestClock.adjust(599_999);
  yield* leases.tick;
  assert.equal(closed, false);
  yield* TestClock.adjust(1);
  yield* leases.tick;
  assert.equal(closed, true);
})).pipe(Effect.provide(TestClock.layer()))));

// @spec docs/feature/web-workbench/architecture.md#服务托管
test('a browser that disconnects during SSE verification leaves no subscription', async () => {
  const root = process.cwd();
  const verifying = Promise.withResolvers<void>();
  const verified = Promise.withResolvers<void>();
  const responseClosed = Promise.withResolvers<void>();
  let connections = 0;
  let subscriptions = 0;
  const unused = (): never => { throw new Error('Unexpected HTTP port'); };
  const server = await startHostedViewServer({ root, port: 0, webRoot: root }, {
    verify: () => { verifying.resolve(); return verified.promise; },
    workspace: unused, refresh: unused, read: unused, git: unused, diff: unused, compile: unused, statechart: unused, action: unused,
    sse: delta => { connections += delta; },
    subscribe: () => { subscriptions++; return () => { subscriptions--; }; },
  }, makeRuntimeEnvironment(root, process.env), () => true);
  try {
    server.server.once('request', (_request, response) => { response.once('close', responseClosed.resolve); });
    const request = get(new URL('/api/events', server.address), { agent: false });
    request.on('error', () => {});
    await verifying.promise;
    request.destroy();
    await responseClosed.promise;
    verified.resolve();
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.deepEqual({ connections, subscriptions }, { connections: 0, subscriptions: 0 });
  } finally { await server.close(); }
});
