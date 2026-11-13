# 修复核验未核对已安装依赖的锁文件

历史提交的依赖锁与当前工作区不同仍会运行，违反修复核验依赖一致性契约。

复现：`bun run test test/domain/verification-lockfiles.test.ts`。
