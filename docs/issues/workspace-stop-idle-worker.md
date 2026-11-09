---
relations:
  - role: spec
    target: docs/feature/local-data-engine/architecture.md#退出
---
# 停止服务时无限等待空闲操作进程

## 现象

停止工作区服务时，操作进程只收到一次 SIGTERM，没有启动 OwnedProcessService 的超时终止与进程组确认。进程暂停或不处理信号时，服务无限留在 stopping，CLI 返回 `CleanupFailed`。

## 复现

运行 `bun run gate test/process/workspace-server-shutdown.test.ts`。通过真实 CLI 启动服务，暂停其已就绪的空闲操作子进程，再从公开入口停止服务。

## 期望

按照[退出协议](../feature/local-data-engine/architecture.md#退出)，停止拥有的进程时执行有界终止，并确认进程组已清理、服务锁与记录已释放。
