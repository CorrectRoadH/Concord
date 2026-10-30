---
status: open
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
