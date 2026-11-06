// 跨进程保证：网络——客户端事件循环阻塞超过服务keep-alive后新HTTP请求仍独立完成。
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';
import { Effect } from 'effect';
import { startViewServer } from '../e2e/server.ts';
import { fixture, send } from '../support/view-http-fixture.ts';


// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('test HTTP requests remain independent after an event-loop stall exceeds server keep-alive', () => Effect.runPromise(Effect.tryPromise(async () => {
  const f = fixture();
  const server = await startViewServer({ ...f, host: '127.0.0.1', port: 0 });
  try {
    assert.equal((await send(server, '/')).status, 200);
    // Reproduce a busy shared loop while an idle socket reaches its deadline.
    Effect.runSync(Effect.sync(() => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 6_500)));
    assert.equal((await send(server, '/')).status, 200);
  } finally { await server.close(); rmSync(f.root, { recursive: true, force: true }); }
})));
