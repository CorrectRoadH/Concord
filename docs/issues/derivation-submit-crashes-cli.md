---
relations:
  - role: spec
    target: docs/feature/local-data-engine/architecture.md
---

# 服务中途消失时提交派生批次让命令崩溃

## 现象

NiceEval 中运行外部 adapter 的窄 `concord --json test discover`：adapter 的 Invocation 与 `collect-parse` 都以 0 退出，278.956 秒时 CLI 在把派生批次交给工作区服务（`RpcClient` 的 cache-derived 请求）时遇到 socket `EPIPE`，命令失败，stdout 是 Effect 的错误日志而不是 JSON（`accept-discover-package-traced.stdout` 与 strace 尾部，niceeval-accept 证据）。当时服务已不存在。

## 期望

派生批次是可重建的缓存（[本地数据引擎](../feature/local-data-engine/architecture.md#工作区服务)）：服务不可用时放弃提交，命令照常返回已经得到的结果，缓存状态报告这次没有写入。任何失败都以带具名错误的 JSON 输出，不把运行时日志写到 stdout。先写服务在提交前消失的失败回归，再按 `--fixed` 修复。
