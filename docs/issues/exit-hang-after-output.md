---
status: open
---

# 命令输出完整 JSON 后进程偶发不退出

并发门禁中多次观察到 CLI 子进程已向 stdout 写出完整的机器可读 JSON，却在 20 s 内没有退出（ETIMEDOUT），例如 `memory show native-recall`、`feedback show`、`design show storage`。另有 21 次超时 stdout 与 stderr 均为空。

已排除：测试原地改写已映射的 `hawdb.node` 导致的 finalizer SIGSEGV（已修复，见提交 d267e06）。64 次并发 8 的 `memory show` 退出时序探测未复现挂起。分类与原始诊断见 check-speed 第二轮交接（`round2-process-classification.md`，副本在 /tmp/check-speed-evidence/）。

这些超时都发生在机器过载期间，根因未定：可能是负载，也可能是退出阶段仍有未释放的句柄、子进程或定时器。下一步在空闲机器上的完整门禁中复核；仍出现时对挂起进程取栈（`--report-on-signal` 或 gdb）定位。

2026-10-29 集成后的完整门禁中再次出现：`test/design-record-links.test.ts` 在小型消费者上运行打包的 `check`，30 s 内未退出（status null）；同一文件在空闲机器上单独复跑 4/4 通过。该门禁的 Node 测试并发为 8，构建与静态检查均通过。
