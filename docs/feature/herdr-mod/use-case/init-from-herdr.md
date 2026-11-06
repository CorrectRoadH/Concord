# 在空仓库里初始化 Concord

## 用户目标

维护者在 Herdr 里开了一个新项目，想直接在 Herdr 里开始用 Concord 写 Spec。

## 起始状态

- Concord mod 已安装。
- 当前 pane 位于一个 Git 仓库，里面还没有 Concord 的文档。

## 完整路径

1. 打开 Concord mod。 {#open}

   mod 在右侧出现，显示“这个仓库还没有初始化 Concord”和“在这里初始化 Concord”按钮。

2. 点“在这里初始化 Concord”。 {#init}

   mod 在仓库根目录运行 `concord init`，显示新建了多少个文件，文档树列出它们。

3. 看推荐的写作指南。 {#guide}

   mod 在新建文件的数量下方显示 init 推荐的[写作指南](../../../concepts.md#writing-guide)，以及交给 agent 的命令（预期输出）：

   ```text
   下一步：让 agent 读写作指南
   concord --skill docs-from-scratch
   ```

   点“阅读指南”，mod 运行这条命令，把指南正文按 Markdown 显示在阅读区。指南怎样选、写了什么见[初始化后按项目情况开始写 Spec](../../project-onboarding/use-case/start-writing-specs.md)。

4. 新建第一个 Feature。 {#new-feature}

   点“新建 Feature”，输入名称和标题；mod 运行 `concord new feature <名称> --title <标题>`，并打开新建的 README 供编辑。

## 结果

仓库完成初始化，文档树显示新建的文档。

| 情形 | 结果 |
| --- | --- |
| 当前目录不在 Git 仓库里 | mod 显示“请先在 Git 仓库中打开”，提供“选择目录” |
| 拿不到当前 pane 的目录 | mod 依次取当前 pane、当前 space 的目录；都拿不到时显示“没有可用的当前目录”并提供“选择目录”，不说成“不在 Git 仓库” |
| 还没有可用的仓库 | 只显示提示与“选择目录”，不显示文档分类与“新建 Feature” |
| 想用另一个目录 | 点“选择目录”，在弹出的目录选择器里选 |
| 仓库已有代码 | 推荐 `docs-from-code` |
| 仓库已经初始化 | 直接显示文档树，不显示初始化按钮和写作指南 |
