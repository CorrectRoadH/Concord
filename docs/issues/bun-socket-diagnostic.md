---
relations:
  - role: spec
    target: docs/feature/local-data-engine/architecture.md#协议
---
# Socket 写入失败丢失底层诊断

## 观察

派生缓存提交遇到 `EPIPE` 时，客户端虽然返回 `WorkspaceServerUnavailable`，消息却只剩 `An error occurred during Write`。Effect 的 socket 错误封装隐藏了实际写入失败原因。

## 期望行为

传输错误维持具名失败，消息保留底层 `EPIPE` 诊断。

## 复现

运行 `pnpm gate test/process/workspace-client-write-failure.test.ts`，真实 RPC 客户端的 socket 写入边界抛出 `EPIPE`，核对返回的错误码与消息。
