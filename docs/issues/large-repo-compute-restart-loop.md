---
relations:
  - role: spec
    target: docs/feature/local-data-engine/architecture.md
---

# 大仓库冷启动时计算进程反复重启，查询一直没有结果

## 现象

在 NiceEval 核心仓库（5294 个 Git 跟踪文件）用构建自 5234d33 的 CLI 运行 `concord --json test list`：约 3 分钟没有输出，最后报 `WorkspaceServerUnavailable` / `TimeoutError`。期间工作区服务主进程已运行 188 秒，计算进程每隔几十秒被新的进程替换（先后观察到运行 57 秒与 10 秒的计算进程），服务状态为 `degraded`，`sourceDigest` 为空，`server status` 没有给出降级原因。`--server command` 因已有服务占有项目报 `WorkspaceServerBusy`。

## 期望

按[进程与资源](../feature/local-data-engine/architecture.md#进程与资源)：计算进程只在无响应或超出预算时重启；一次合法但耗时较长的冷扫描不应被当作无响应反复终止，导致查询永远得不到结果。降级时 `server status` 报告原因。先在 scale 消费者或 NiceEval 的副本上写出“冷扫描超过 60 秒仍能完成”的失败回归，再按 `--fixed` 修复；需要改变超时或预算规则时把证据发给 t84。
