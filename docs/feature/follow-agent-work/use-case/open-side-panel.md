---
format: concord.document/v1
id: open-side-panel
title: 在终端侧边打开 Spec 面板
createdAt: 2026-10-30T01:50:54.567Z
kind: use-case
feature: docs/feature/follow-agent-work/README.md
---

# 在终端侧边打开 Spec 面板

维护者在 agent 所在的 Herdr tab 中按下 Concord 插件的快捷键，或在任意终端运行 `concord panel`，在 agent 旁边打开当前工作树的 Spec 面板。

## 主流程

1. 在 Herdr 中触发插件，面板在当前 pane 右侧打开，跟随该 pane 的工作树；在其它终端中运行 `concord panel`，跟随当前目录所在的工作树，或用 `--root` 指定。
2. 面板列出关注范围内的 Feature，每个 Feature 下列出被触及的 Use Case，每个 Use Case 显示关联测试的最近状态。关注范围为空时列出全部 Feature。
3. 用方向键或 `j`/`k` 移动，回车展开或进入详情，`Esc` 返回，`/` 筛选，`a` 在关注范围与全部之间切换，`q` 退出。
4. 退出面板后 pane 关闭或回到 shell。

## 验收

- 工作区已有可读投影时，从启动到首屏可读不超过 300ms，不触发全量扫描；尚无投影时显示构建中及进度，完成后自动替换，不出现空白屏。
- 宽度不少于 40 列时可用；更窄时提示所需宽度。终端尺寸变化后重排，保留选中项。遵守 `NO_COLOR`，不依赖颜色区分状态。
- 当前目录不在 Git 工作树中，或工作树没有 Concord 配置时，显示原因与 `concord init` 提示并以非零码退出。配置无法读取时显示配置诊断，不显示为待初始化。
- 面板运行期间，同一工作树上 agent 的 CLI 调用不因面板而失败、等待锁或报告 `HawdbBusy`；多个面板可以同时打开。
- 面板不写入任何仓库文件，不暂存、提交或 push。退出后不留下监听、定时器、锁或子进程。
- Herdr 插件随 Concord 包发布；未安装 Herdr 时 `concord panel` 照常运行。
