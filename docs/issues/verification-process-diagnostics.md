# 修复核验丢失失败进程诊断

adapter 协议进程失败只有固定消息；runner 失败也没有提交上下文和输出尾部，违反修复核验进程诊断契约。

复现：`bun run test test/domain/verification-process-diagnostics.test.ts`。
