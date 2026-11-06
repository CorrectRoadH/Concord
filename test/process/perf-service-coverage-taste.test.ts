// 跨进程保证：服务与 IPC——性能烟雾场景启动真实工作区服务并等待投影就绪，经服务完成查询后回收。
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { benchmarkSmoke } from '../support/benchmark-smoke.ts';

// @feature docs/feature/local-sdlc/README.md
test('taste service benchmark scenarios execute on minimal frozen consumers without timing verdicts', { timeout: 180_000 }, t =>
  Effect.runPromise(benchmarkSmoke(true, 'taste').pipe(Effect.scoped, Effect.provide(NodeServices.layer)), { signal: t.signal }));
