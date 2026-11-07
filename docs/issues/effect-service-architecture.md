# 代码尚未按 Effect 服务组合

## 现象

[代码结构](../engineering/code/architecture.md)规定领域逻辑只依赖 Effect 服务、副作用由基础服务提供、各进程以 Layer 组合。Workspace、Sources、Publication、Cache、Git 与 OwnedProcess 基础服务已经建立，`src/domain`、`src/app` 与 `src/model` 不再导入 `node:fs`（2026-11-06，全仓 23 处 `Context.Service`）。仍有 25 个源文件使用同步的 `LocalRepository` 类，CLI 以 `sync(() => …)` 包装这些调用。

## 差距

- 领域模块按服务迁移，删除同步入口，不保留双轨。
- 工作区服务协议用 `effect/rpc` 与 `effect/socket` 实现；Queries 提供 Local 与 Remote 两层。
- 订阅、合并刷新与唯一刷新者分别使用 SubscriptionRef、Schedule 与 Semaphore；RPC 的在途请求由 `RpcServer` 自身管理，Concord 自己拥有的长期任务集合（如 HTTP 订阅）用 FiberSet 或 FiberMap，不为 RPC 再包一层请求管理。
- 测试中的时间用 TestClock，RPC 用 RpcTest。
