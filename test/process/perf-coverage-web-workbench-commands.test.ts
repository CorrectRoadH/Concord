// 跨进程保证：服务与 IPC——性能烟雾场景启动真实view服务并经CLI读取已发布工作区投影。
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { benchmarkSmoke } from '../support/benchmark-smoke.ts';

// @feature docs/feature/local-sdlc/README.md
test('web-workbench-commands ordinary benchmark scenarios execute on minimal frozen consumers without timing verdicts', { timeout: 180_000 }, t =>
  Effect.runPromise(benchmarkSmoke(false, 'web-workbench', [2, 3]).pipe(Effect.scoped, Effect.provide(NodeServices.layer)), { signal: t.signal }));
