---
status: open
---

# Herdr 插件未在真实主机上验证

## 现象

[打开侧边面板](../feature/herdr-panel/use-case/open-side-panel.md)的插件清单与 action 只对照了本机已安装的第三方 Herdr 插件，没有在真实 Herdr 上执行安装、构建绑定与打开 pane。开发机没有 `herdr-app`。

## 待核验

- Herdr 能否从本地目录安装插件，构建步骤能否取得 `CONCORD_INSTALLATION`。
- `herdr plugin pane open` 传入当前 pane 工作目录与目标 pane 的参数名，以及 `min_herdr_version` 是否支持它们。
- 插件上下文缺少工作目录时 action 报 `PanelWorktreeUnknown`，不打开 pane。

在装有 Herdr 的机器上完成以上核验后关闭本 Issue，偏差写回 [Herdr 面板架构](../feature/herdr-panel/architecture.md#herdr-插件)。
