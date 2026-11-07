---
relations:
  - role: spec
    target: docs/feature/local-data-engine/use-case/use-unified-cache.md
---

# CLI 读命令把 HawdbBusy 直接返回给调用者

## 现象

多个 agent 在同一 worktree 并行运行 Concord 时，只读命令曾直接以 `HawdbBusy` 失败（2026-10-29：`pnpm concord trace show` 第一次返回 HawdbBusy，立即重试通过）。之后加入了工作区服务，尚未在现行代码上复核。

## 期望

数据库被其他进程占用时，源码解析改用本进程的内存缓存照常完成，缓存状态报告 `HawdbBusy`，命令不以它失败（[统一缓存](../feature/local-data-engine/use-case/use-unified-cache.md)、[架构](../feature/local-data-engine/architecture.md)）。先在没有工作区服务、另一进程持有数据库的条件下写失败回归；复现则按 `--fixed` 修复，现行代码已满足则以 `--reason` 写明覆盖它的测试后关闭。
