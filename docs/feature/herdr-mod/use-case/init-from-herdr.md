# 在空仓库里初始化 Concord

## 用户目标

维护者在 Herdr 里开了一个新项目，想直接在 Herdr 里开始用 Concord 写 Spec。

## 起始状态

- Concord mod 已安装。
- 当前 pane 位于一个 Git 仓库，里面还没有 Concord 的文档。

## 完整路径

1. 打开 Concord mod。 {#open}

   mod 在右侧出现，显示“这个仓库还没有初始化 Concord”和一个“初始化”按钮。

2. 点“初始化”。 {#init}

   mod 在仓库根目录运行 `concord init`，然后列出新建的文件：

   ```text
   docs/README.md
   docs/taste.md
   docs/concepts.md
   docs/concord-writing.json
   memory/README.md
   AGENTS.md
   ```

3. 新建第一个 Feature。 {#new-feature}

   点“新建 Feature”，输入名称和标题；mod 运行 `concord new feature <名称> --title <标题>`，并打开新建的 README 供编辑。

## 结果

仓库完成初始化，文档树显示新建的文档。

| 情形 | 结果 |
| --- | --- |
| 当前目录不在 Git 仓库里 | mod 显示“请先在 Git 仓库中打开”，提供“选择目录” |
| 想用另一个目录 | 点“选择目录”，在弹出的目录选择器里选 |
| 仓库已经初始化 | 直接显示文档树，不显示“初始化” |
