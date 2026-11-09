---
relations:
  - role: spec
    target: docs/feature/local-data-engine/architecture.md#状态
---
# 原生缓存打开阻塞工作区服务握手

服务发布 `opening` 后，在 JS 主线程同步执行 HawDB 打开、建表和 checkpoint。多个测试并行时观察到事件循环停顿超过 1 秒，已经连接的客户端无法及时收到 `hello`，返回 `WorkspaceServerUnavailable` 或作用域过期。关闭持久库也在主线程同步执行 checkpoint。

`opening` 必须允许 `hello`。原生生命周期不能阻塞服务事件循环，取消与退出必须等数据库和协调锁释放后完成。

复现：`bun run test test/domain/cache-owner-lifecycle.test.ts`。测试用真实空目录打开服务持久 owner，观察同线程计时器能否在打开完成前执行，并检查关闭路径。它证明生命周期阻塞，不把全部并行测试失败归因于此。
