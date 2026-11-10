# 从零写 Spec

适用于刚初始化、还没有代码的项目。Spec 先于实现：先写清目标和行为，再按 Spec 实现。整个过程直接编辑 `docs/` 下的文件，每写完一批运行 `concord check`，逐个处理具名 finding。

维护者已经选定这条路；还没选时先读 `concord --skill start`。

## 1. 确认项目给谁用

和维护者确认三件事：谁会用这个项目、它替使用者解决什么问题、第一版必须能做到什么。把结论写在 `docs/README.md` 开头，两三句即可。没有确认的猜测不写进 Spec，先问维护者。

## 2. 写品味

品味是维护者判断“什么是好的”的标准。把对话中出现的判断写成 `docs/taste.md` 的条目：一句话标题，正文写它解决的问题、好的样子和坏的样子，不写实现机制。只写维护者确认过的判断，并删掉模板里的示例；示例不是这个项目的规则。

## 3. 写第一个 Feature

一项能力一个 Feature，先只写最重要的一个：

```sh
concord new feature <name> --title "<标题>" --pages use-case
```

README 像使用教程：开头两三句说明谁用、解决什么问题；「你可以做什么」每项一句；「上手」给一个照着就能运行的例子。代码还不存在，示例全部标为预期输出。

## 4. 每个用户目标写一个 Use Case

```sh
concord new use-case <name> --feature <feature>
```

写清怎样使用来满足需求：起始状态、每步界面操作、命令或调用、看到的结果，以及完成判据。路径可以组合外部工具，写清准备与交接方式，详见 `concord --skill document`。主流程步骤带 `{#id}`，以后测试和实现指向这些步骤。同一路径的输入变化与错误结果用表格，处理路径明显不同时另写一个 Use Case。

## 5. 先定义名词

写下一个领域名词前，先在 `docs/concepts.md` 定义它：`## 订单 {#order}`，下面第一段是定义。一个概念只用一种写法。

## 6. 写系统边界

系统由哪些部分组成、数据怎样流动、哪些不变量必须成立，写进 `docs/architecture.md`。单个 Feature 的内部设计等到开始实现时再写进它的 `architecture.md`。

## 7. 实现并对上 Spec

按 Spec 实现。实现源码加代码声明，测试加标记，命令见 `concord --skill code` 与 `concord --skill test`。实现完成后，在临时仓库实际运行命令，用真实输出替换预期输出。`concord trace` 显示每个 Use Case 由哪些测试守护。

开发过程、排障经过和取舍写进 `memory/`，没处理完的问题写进 `docs/issues/`，`docs/` 的 Spec 只写当前声明。页面写法的完整规则见 `concord --skill document`。
