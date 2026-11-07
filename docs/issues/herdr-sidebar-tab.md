---
relations:
  - role: spec
    target: docs/feature/herdr-mod/use-case/follow-changes.md
---
# Concord 侧栏切换 tab 后仍显示原仓库

## 现象

布局右侧的 Concord mod 在 it-infra 中打开后，切到另一台机器的 Concord tab，标题、路径与 CLI 错误仍显示 it-infra。

## 期望

按[自动刷新](../feature/herdr-mod/use-case/follow-changes.md)，布局侧栏跟随当前 tab 的机器与仓库。独立分屏 pane 仍固定跟随所属 tab，未保存草稿保留在原仓库。

## 复现

1. 在布局右侧打开 Concord 侧栏。
2. 切换到另一个仓库的 tab，或另一台机器的 space。
3. 观察侧栏仍显示打开时的路径，且没有读取当前仓库。

回归命令：`bun run gate test/model/herdr-mod-host.test.ts`。
