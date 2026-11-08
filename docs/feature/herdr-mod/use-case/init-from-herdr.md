# 在空仓库里初始化 Concord

## 用户目标

维护者在 Herdr 里开了一个新项目，想直接在 Herdr 里开始用 Concord 写 Spec。

## 起始状态

- Concord mod 已安装。
- 当前 pane 位于一个 Git 仓库，里面还没有 Concord 的文档。

## 完整路径

1. 打开 Concord mod。 {#open}

   mod 在右侧出现，以[状态页](../ui.md#状态页)显示“这个仓库还没有初始化 Concord”、仓库路径和“在这里初始化 Concord”按钮。

2. 点“在这里初始化 Concord”。 {#init}

   mod 在仓库根目录运行 `concord init`，显示新建了多少个文件，文档列表列出它们。

3. 看推荐的写作指南。 {#guide}

   mod 在新建文件的数量下方显示 init 推荐的[写作指南](../../../concepts.md#writing-guide)，以及交给 agent 的命令（预期输出）：

   ```text
   下一步：让 agent 读写作指南
   concord --skill docs-from-scratch
   ```

   点“阅读指南”，mod 运行这条命令，把指南正文按 Markdown 显示在阅读区。指南怎样选、写了什么见[初始化后按项目情况开始写 Spec](../../project-onboarding/use-case/start-writing-specs.md)。

4. 在终端里让 agent 写第一个 Feature。 {#new-feature}

   mod 是用来读的，不提供新建文档的按钮：新 Feature 要先想清楚用户故事，这件事在和 agent 的对话里完成。agent 按写作指南创建 Feature 后，它在一秒内出现在文档列表里，点开就能读。

## 结果

仓库完成初始化，文档列表显示新建的文档。

| 情形 | 结果 |
| --- | --- |
| 终端的当前目录不在 Git 仓库里 | 显示“这里不是 Git 仓库”、这个目录，以及“在终端里 `cd` 到一个 Git 仓库，mod 会跟着切换” |
| 当前 tab 里没有终端，或终端还没有报告目录 | 显示“先在这个 tab 里打开一个终端”，不说成“不在 Git 仓库” |
| 当前终端位于远程机器 | 在那台机器上初始化，见[在远程机器的终端旁使用](use-on-remote-machine.md) |
| 还没有可用的仓库 | 只显示状态页，不显示文档列表 |
| 想用另一个仓库 | 在终端里 `cd` 过去，mod 在 1 秒内跟着切换 |
| 切换时有未保存的草稿 | 不切换，草稿上方提示“终端已切到 <目录>，保存或放弃修改后切换” |
| 仓库已有代码 | 推荐 `docs-from-code` |
| 仓库已经初始化 | 直接显示文档列表，不显示初始化按钮和写作指南 |
