// 跨进程保证：外部程序——性能烟雾场景经真实Herdr mod宿主调用CLI，两个宿主模式成功且冻结消费者保持不变。
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { benchmarkSmoke } from '../support/benchmark-smoke.ts';

// @feature docs/feature/local-sdlc/README.md
test('herdr-mod ordinary benchmark scenarios execute on minimal frozen consumers without timing verdicts', { timeout: 180_000 }, t =>
  Effect.runPromise(benchmarkSmoke(false, 'herdr-mod').pipe(Effect.scoped, Effect.provide(NodeServices.layer)), { signal: t.signal }));
