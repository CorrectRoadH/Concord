---
relations:
  - role: spec
    target: docs/engineering/testing/README.md
---

# 同一台机器上的门禁没有排队

## 现象

多个 agent 在同一 worktree 开发时会同时运行 `pnpm gate`。2026-10-29 两个完整门禁同时运行时 load 达 16，出现成批的超时与连接重置，空闲重跑全部通过。现在只靠约定避免并发，门禁本身不排队。

## 期望

按[共享资源与同步](../engineering/testing/README.md#共享资源与同步)的负载规则：后到的门禁排队等前一次结束，等待期间报告正在运行的门禁，等待时间单独报告且不计入墙钟；前一次门禁的进程已不存在时直接开始。测试覆盖两次并发调用的先后、等待报告与持有者崩溃后的接管。完成后以 `--reason` 关闭。
