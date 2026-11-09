# 初始化后开始写 Spec

## 用户目标

维护者刚接入 Concord，想让 coding agent 马上开始写第一批 Spec。新项目要从目标写起，已有项目要从现有行为补写；走哪条路只有维护者清楚，例如仓库里有代码，但维护者打算推倒重写。所以 init 不替维护者判断，只给出一句交给 agent 的话，由 agent 问维护者。

## 起始状态

- 当前目录是一个还没有初始化 Concord 的 Git worktree 顶层。
- 维护者从终端运行 CLI，或在 Herdr 中打开 Concord mod，两种入口结果相同。

## 完整路径

1. 初始化。 {#init}

   在终端运行：

   ```sh
   concord init
   ```

   或在 Herdr 的 Concord mod 里点“在这里初始化 Concord”，见[在空仓库里初始化 Concord](../../herdr-mod/use-case/init-from-herdr.md)。

2. 看到交给 agent 的下一步。 {#guide}

   以下为预期输出，人读输出的最后几行：

   ```text
   Start here: docs/concord.md
   Writing guide: concord --skill start
   Inspect configuration: concord doctor
   ```

   每个仓库都给出同一条命令。Concord mod 在新建文件的数量下方显示一段交给 agent 的请求，见[在空仓库里初始化 Concord](../../herdr-mod/use-case/init-from-herdr.md#guide)。

3. 把这条命令交给 agent。 {#read-guide}

   维护者对 agent 说“运行 `concord --skill start`，和我一起开始写 Spec”。agent 运行：

   ```sh
   concord --skill start
   ```

   输出是随归档提供的说明正文，不读取项目，也不写文件。

4. agent 问维护者从哪里写起。 {#ask}

   agent 先看一眼仓库，把看到的情况作为建议说出来，再问维护者选哪条路（以下为预期输出）：

   ```text
   仓库里有 src/ 和 package.json，还有 40 个测试，看起来已经有代码在用。
   要我先为现有代码补写 Spec，还是从零写一份新项目的 Spec？
   ```

   维护者回答之前，agent 不创建文档。

5. agent 读选定的写作指南，写第一批 Spec，然后检查。 {#write}

   | 维护者的选择 | agent 读的指南 |
   | --- | --- |
   | 从零写 | `concord --skill docs-from-scratch` |
   | 为已有代码补写 | `concord --skill docs-from-code`，完整路径见[为已有代码补写 Spec 并纳管存量测试](document-existing-code.md) |

   每写完一批运行一次：

   ```sh
   concord check
   ```

   逐个处理具名 finding。

## 两份写作指南

[写作指南](../../../concepts.md#writing-guide)随时都能读取，与 init 无关；`concord --skill` 的入口也列出它们，以后再接入的 agent 不依赖 init 的输出。

`docs-from-scratch` 引导 agent 按这个顺序写：

| 顺序 | 写什么 |
| ---: | --- |
| 1 | 和维护者确认项目给谁用、解决什么问题，写进 `docs/README.md` 开头。 |
| 2 | 把维护者确认过的判断标准写成 `docs/taste.md` 的条目，替换模板里的示例。 |
| 3 | 为第一项能力创建 Feature：README 像使用教程，上手示例标为预期输出。 |
| 4 | 每个用户目标写一个 Use Case，主流程步骤带 `{#id}`。 |
| 5 | 领域名词先进 `docs/concepts.md`，再出现在 Spec 里。 |
| 6 | 系统边界写进 `docs/architecture.md`；Feature 的内部设计在开始实现时写进它的 architecture 页。 |
| 7 | 实现时给源码加代码声明、给测试加标记，再把预期输出换成实际运行的输出。 |

`docs-from-code` 引导 agent 按这个顺序写：

| 顺序 | 写什么 |
| ---: | --- |
| 1 | 盘点使用者能接触到的入口：命令、公开 API、页面、配置和现有测试，列出候选 Feature 交给维护者确认。 |
| 2 | 每批只写一个 Feature。谁用、为什么用问维护者；行为页的示例来自实际运行，不凭阅读代码推测。 |
| 3 | 读不出意图的行为不写成规则，写成 Issue，由维护者决定它是需求还是缺陷。 |
| 4 | 给已有实现加代码声明，给已有测试加标记，让 `concord trace` 显示 Use Case 由哪些测试守护。 |
| 5 | 仓库原有的文档保留原文，其中仍然成立的内容并入对应 Feature，其它的留给维护者处理。 |
| 6 | 品味从代码中反复出现的取舍里提炼，经维护者确认后再写进 `docs/taste.md`。 |

## 结果

仓库完成初始化，agent 按维护者选定的路径开始写 Spec。

| 情形 | 结果 |
| --- | --- |
| 初始化被拒绝，例如 `InitializationConflict` | 不输出下一步，错误见[接入并取得模板](../../local-sdlc/use-case/onboard-from-template.md#结果) |
| 已有代码，但维护者要推倒重写 | 维护者选从零写，agent 读 `docs-from-scratch` |
| 已有代码，还要做大改动 | 先为已有代码补写现状，再按 `concord --skill spec` 写改动 |
| 写到一半想换路径 | 直接读另一份指南，init 不需要重跑 |
| 未知的 skill 主题 | `concord --skill` 返回 `SkillTopicUnknown` |

## Spec 来源

[目标与范围](../README.md)；命令与输出见 [CLI](../../local-sdlc/cli.md#接入)。
