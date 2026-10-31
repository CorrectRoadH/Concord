---
status: open
---

# 维护排空期间的写入被直接拒绝而不排队

## 现象

工作区服务执行 `cache clear` 时进入 draining，操作进程的调度被暂停。此时到达的 HTTP 普通写入立即以 `WorkspaceServerBusy` 失败。

## 期望

draining 状态下，新的相关请求排队，已受理的请求完成后才进入清理；清理结束、维护释放后按顺序执行排队的请求（[状态](../feature/local-data-engine/architecture.md#状态)）。排队受全服务 256 个排队请求的上限约束，超出时才以 `WorkspaceServerBusy` 失败（[协议](../feature/local-data-engine/architecture.md#协议)）。每个写入仍由独立的操作进程执行。

## 修复

先以进程内 Layer 与 TestClock 复现 draining 期间写入被拒，再修复受理与排队。
