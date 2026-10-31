---
status: closed
closure:
  kind: fixed
  reason: 排空等待已受理操作完成，后续写入排队至维护释放。RPC 与 HTTP 共用 256 个未应答请求额度，取消时释放额度。
  verification:
    defect: fc571213206ddcbebfc2b4b5843d41890fde4f3a
    fix: 137ed8fafa065b39340fecb2962f3be55b2b0b00
    tests:
      - neref_3a4256921608cae9dcf474a4d0c6a513
      - neref_b12df9bcad491eeee386dfe489406a61
    runner: sha256:db83e0ff88b65dcaaf52a8f69c6262dbd1b596991eee44d5fcf69e1a65b4e8e0
    concord: dev
---

# 维护排空期间的写入被直接拒绝而不排队

## 现象

工作区服务执行 `cache clear` 时进入 draining，操作进程的调度被暂停。此时到达的 HTTP 普通写入立即以 `WorkspaceServerBusy` 失败。

## 期望

draining 状态下，新的相关请求排队，已受理的请求完成后才进入清理；清理结束、维护释放后按顺序执行排队的请求（[状态](../feature/local-data-engine/architecture.md#状态)）。排队受全服务 256 个尚未应答请求的上限约束，超出时才以 `WorkspaceServerBusy` 失败（[协议](../feature/local-data-engine/architecture.md#协议)）。每个写入仍由独立的操作进程执行。

## 修复

先以进程内 Layer 与 TestClock 复现 draining 期间写入被拒，再修复受理与排队。
