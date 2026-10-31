# 代码尚未按 Effect 服务组合

## 现象

[代码结构](../architecture.md#代码结构)规定领域逻辑只依赖 Effect 服务、副作用由基础服务提供、各进程以 Layer 组合。实现中只有 6 处定义 `Context.Service`；多数领域代码是同步函数与 `LocalRepository` 类，CLI 用 `sync(() => …)` 包装，直接使用 `node:fs`、`node:child_process` 与 `process` 全局状态。

## 差距

- 建立 Workspace、Sources、Publication、Cache、Git、OwnedProcess 基础服务与其实现层。
- 领域模块按服务迁移，删除同步入口，不保留双轨。
- 工作区服务协议用 `unstable/rpc` 与 `unstable/socket` 实现；Queries 提供 Local 与 Remote 两层。
- 订阅、合并刷新、唯一刷新者、在途取消分别使用 SubscriptionRef、Schedule、Semaphore 与 FiberMap。
- 测试中的时间用 TestClock，RPC 用 RpcTest。
