---
relations:
  - role: spec
    target: docs/feature/herdr-mod/use-case/init-from-herdr.md
---
# 侧栏没有重绘时保留旧仓库目录

## 观察

macOS 的终端在 `~/Code/it-infra`，Concord 侧栏显示 `~/Code/ljkx`。已安装 mod 的 SHA256 对应提交 `a612652`；Herdr 状态的活动 tab 与 pane 正确，布局中的 Concord 没有指定固定 pane，也没有加载错误。

源码只在初始化与重绘时观察目录；CLI 正常且机器可达时，现有定时器不观察目标。宿主没有重绘侧栏时，即使实时终端状态变化，侧栏仍显示旧仓库。该缺口可以独立复现；用户机器是否由这一路径触发仍须实际验收。

## 期望与复现

按初始化 Use Case，终端切换目录后在一秒内跟随。`bun run gate test/model/herdr-mod-host.test.ts` 中，更新宿主实时目录、tab 或终端列表，不主动调用 View 重绘，只触发一秒时钟；面板应随目标更新。目标不变时没有额外重绘或命令，关闭后停止观察。
