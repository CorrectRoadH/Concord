---
relations:
  - role: spec
    target: docs/feature/local-data-engine/architecture.md
---

# 服务中途消失时提交派生批次让命令崩溃

## 现象

NiceEval 中运行外部 adapter 的窄 `concord --json test discover`：adapter 的 Invocation 与 `collect-parse` 都以 0 退出，278.956 秒时，CLI 把派生批次交给工作区服务（`RpcClient` 的 cache-derived 请求），遇到 socket `EPIPE`。命令因此失败，stdout 是 Effect 的错误日志而不是 JSON（证据见 niceeval-accept 的 `accept-discover-package-traced.stdout` 与 strace 尾部）。当时服务已不存在。

## 期望

按[本地操作的缓存快照](../feature/local-data-engine/architecture.md#本地操作的缓存快照)：只产出缓存的 `test discover` 与 `code analyze` 在派生批次提交失败时返回失败，以 JSON 输出具名错误 `CacheUpdateFailed`，details 给出传输或保存失败的原因；其它操作保留完成结果并输出 `CacheUpdateFailed` 警告。任何情况下都不崩溃，也不把运行时日志写到 stdout。先写服务在提交前消失的失败回归，再按 `--fixed` 修复。
