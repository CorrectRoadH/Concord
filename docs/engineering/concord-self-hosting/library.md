# 测试适配与依赖

本仓库测试由配置的 `node:test` runner 执行。关联由 Concord 标记拥有，不由测试声明形状决定。同步测试体使用 `Effect.sync`，Node adapter 回调使用 `Effect.runPromise`；资源型测试继续使用 `Effect.scoped` 与 acquire/release。

`test/support.ts` 是明确的支持脚本并进入 sourceFiles；owner 测试直接写出声明，不通过包装函数隐藏。`tsx` 负责 Node 测试期加载严格 TypeScript；`package.json`、`pnpm-lock.yaml` 与 `tsconfig.test.json` 共同进入 evidence definition digest。

## 测量脚本

`scripts/bench.ts`、`scripts/profile.ts` 与 `scripts/perf/*.ts` 是严格 TypeScript，经 `tsconfig.scripts.json` 纳入 typecheck，由 `tsx` 执行，副作用通过 Effect 管理。不新增 JavaScript 脚本或测量依赖。`package.json` 提供 `bench` 与 `bench:profile` 两个入口，均先执行 `pnpm build`。

消费者准备与 cli/view 路径走公开 CLI；刷新测量调用构建产物中的内部 query-scan-worker，并以 `src/query-scan-protocol` 的 Schema 解码其消息。fs 计数模块与 CPU profiler 只在 profile 路径注入，bench 样本不带任何注入。

`test/perf-budgets.test.ts` 用当前 owner 正文验证预算表能被解析、每条命令的子命令存在于当前 CLI，并覆盖 p50、无效样本、回退与上限判定。测试关联本地 SDLC Feature 的性能预算，不运行测量路径，也不断言绝对耗时。
