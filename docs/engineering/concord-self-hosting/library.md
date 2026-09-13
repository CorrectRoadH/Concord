# 测试适配与依赖

真实测试文件从 `node:test` 直接导入 `test`、`before` 或 `after`，使 TypeScript AST 能把 Concord 注释绑定到明确声明。同步测试体使用 `Effect.sync`，Node adapter 回调使用 `Effect.runPromise`；资源型测试继续使用 `Effect.scoped` 与 acquire/release。

`test/support.ts` 保留为明确的支持脚本并进入 sourceFiles，即使 owner 测试不再通过包装函数隐藏声明。`tsx` 负责 Node 测试期加载严格 TypeScript；`package.json`、`pnpm-lock.yaml` 与 `tsconfig.test.json` 共同进入 evidence definition digest。
