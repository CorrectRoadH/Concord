# 修复核验缺少 workspace 依赖目录

修复核验仅链接根 node_modules，workspace 成员与 Python 环境缺少依赖，违反修复核验的依赖目录复用契约。

复现：`bun run test test/domain/verification-dependencies.test.ts`。
