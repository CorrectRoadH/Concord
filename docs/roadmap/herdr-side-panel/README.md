# 在 Herdr 侧边面板中跟随 agent 查看 Spec

## Problem

维护者在 Herdr 中同时监督多个 coding agent。agent 正在实现哪个 Feature、改动触及哪些 Use Case、相关测试最近是红是绿、正文用了哪些概念，现在只能离开终端打开 `concord view`，或者自己运行 `trace show` 拼起来。监督发生在终端里，Spec 却在另一个窗口里。

## Core Mental Model

- 侧边面板：在 Herdr 的一个 pane 中运行的 Concord 终端界面，跟随一个工作树。
- 关注范围：当前工作树相对 HEAD 的变更通过源码标记关联到的 Feature 与 Use Case；没有变更时为全部 Feature。
- 面板只读取共享工作区投影与收据，不拥有任何声明；编辑仍由 CLI、编辑器或 Web 完成。

## 使用场景

维护者在 agent 所在的 tab 里按下插件快捷键，或在右侧 pane 运行 `concord panel`。

1. 面板在右侧打开，列出关注范围内的 Feature 和 Use Case，每个 Use Case 下显示关联测试及最近一次收据的状态。
2. agent 写入文件后，面板在一秒内更新关注范围与测试状态，不闪烁，也不打断维护者的选择与滚动位置。
3. 选中 Use Case 时显示主流程与验收；选中测试时显示源码位置与最近收据；正文中的术语可以展开为 `concepts.md` 中的定义。
4. 面板可以切换到另一个工作树，用来跟随在独立 worktree 中工作的 agent。

## 验收

- 打开面板到首屏可读不超过 300ms，渲染已有的投影，不触发全量扫描。
- 多个面板和 agent 的 CLI 调用并发运行，互不报告 `HawdbBusy`。
- 关闭面板不留下监听、定时器或锁。
- 不是 Herdr 的终端里也能运行；Herdr 只提供插件入口和 pane 放置。

## 依赖与待定

实时更新与并发读取要求有一个进程长期持有缓存并监听来源变化，这正是 CLI 热路径设计中 hawdb-owner-service 候选所要解决的问题。面板应当和 Web 工作台、CLI 一样，是这个常驻进程的薄客户端，而不是再建一套扫描与锁重试。该设计裁决之前，本方向不进入 Feature。

## Scope

不在面板中编辑 Spec、运行测试或执行生命周期操作；不替代 Web 工作台的富文本编辑与变更审阅。
