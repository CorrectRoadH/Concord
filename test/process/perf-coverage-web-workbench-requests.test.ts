// 跨进程保证：网络——性能烟雾场景在真实HTTP连接并发请求工作台，所有伴随请求与目标响应均通过严格解码。
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { benchmarkSmoke } from '../support/benchmark-smoke.ts';

// @feature docs/feature/local-sdlc/README.md
test('web-workbench-requests ordinary benchmark scenarios execute on minimal frozen consumers without timing verdicts', { timeout: 180_000 }, t =>
  Effect.runPromise(benchmarkSmoke(false, 'web-workbench', [0, 1]).pipe(Effect.scoped, Effect.provide(NodeServices.layer)), { signal: t.signal }));
