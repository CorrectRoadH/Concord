// 跨进程保证：外部程序——真实 mod 宿主通过 CLI 在两个仓库间切换，服务已运行且消费者保持冻结。
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { benchmarkSmoke } from '../support/benchmark-smoke.ts';

// @feature docs/feature/herdr-mod/README.md
test('herdr-mod switch benchmark scenarios use running services on frozen consumers', { timeout: 180_000 }, t =>
  Effect.runPromise(benchmarkSmoke(true, 'herdr-mod').pipe(Effect.scoped, Effect.provide(NodeServices.layer)), { signal: t.signal }));
