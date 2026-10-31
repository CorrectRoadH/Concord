---
status: closed
closure:
  kind: closed
  reason: P3 已交付（至 6a22940）：服务锁、运行记录与 socket 协议、计算进程与预热的单次操作进程、服务操作表、持久缓存所有权与无服务时只开已有库、CLI 白名单经服务查询、SSE、concord panel 与 Herdr 清单、服务与面板的 bench 场景和预算行。验收 C14–C16、C20–C24 与 7 个新增场景 reference 均通过，证据见交接。Herdr 真实主机核验由 herdr-plugin-host-unverified 跟踪。
---

# 工作区服务与 Herdr 面板尚未实现

## 现象

[工作区服务](../feature/local-data-engine/architecture.md#工作区服务)、[Herdr 面板](../feature/herdr-panel/README.md)与 Web 的 SSE 推送已写入 Spec，实现仍是旧模型：`concord view` 自己持有刷新租约并与 CLI 争用持久缓存，没有 `concord panel`、`concord server`，持久缓存被占用时 CLI 仍报告 `HawdbBusy`。

## 差距

- 原生绑定新增服务锁；运行记录、socket 协议与启动裁决。
- `ViewProjectionManager` 移入服务，删除 `workspace-refresh` 租约与发布重试；`view` 改为服务客户端，SSE 替代轮询。
- 持久缓存占用时降为内存缓存（同时解决 [hawdb-busy-cli-read](hawdb-busy-cli-read.md)）。
- 查询刷新在有服务时由服务执行；CLI 只读命令经由服务查询。
- `concord panel`、终端渲染依赖选型与 Herdr 插件；插件上下文字段与 split 方向待核实。
- 面板首屏、推送延迟与服务查询的 bench 场景与预算行。

## 依据

[决策依据](../design/cli-hot-path/DECISION.md)。该设计未经独立审查，实现前先完成审查。
