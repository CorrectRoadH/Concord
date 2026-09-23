# 测试适配与依赖

本仓库测试由配置的 `node:test` runner 执行。关联由 Concord 标记拥有，不由测试声明形状决定。同步测试体使用 `Effect.sync`，Node adapter 回调使用 `Effect.runPromise`；资源型测试继续使用 `Effect.scoped` 与 acquire/release。

`test/support.ts` 保留为明确的支持脚本并进入 sourceFiles，即使 owner 测试不再通过包装函数隐藏声明。`tsx` 负责 Node 测试期加载严格 TypeScript；`package.json`、`pnpm-lock.yaml` 与 `tsconfig.test.json` 共同进入 evidence definition digest。
