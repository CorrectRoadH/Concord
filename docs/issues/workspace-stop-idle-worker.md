---
relations:
  - role: spec
    target: docs/feature/local-data-engine/architecture.md#退出
---
# 工作区服务停止后仍保留资源

## 现象

远程读取 Concord 仓库时，旧服务的记录处于 `stopping`，socket 无法握手，服务进程仍持有服务锁、缓存句柄和两个计算子进程。后续命令返回 `CleanupFailed: Workspace service shutdown could not be confirmed`。

向旧服务再次发送 SIGTERM、分别终止两个计算子进程均未使服务退出。确认子进程已结束后终止旧服务，新实例可以取得锁并返回工作区投影。旧进程的内部等待位置尚未确定。

## 复现

现场未保存可重放的触发序列。`bun run test test/process/workspace-server-shutdown.test.ts` 验证了两条尚未复现故障的路径：暂停空闲操作进程后停止服务，以及 HTTP 操作进行中中断服务。两条路径均能释放资源；OwnedProcess 的平台 kill 实际已经包含信号升级，不能把问题归因于缺少 SIGKILL。

## 期望

定位实际未完成的清理阶段，建立在缺陷上失败的回归，再修复。按照[退出协议](../feature/local-data-engine/architecture.md#退出)，服务退出必须确认进程组已清理、服务锁与记录已释放。
