# 初始化后按项目情况开始写 Spec

## 用户目标

维护者刚接入 Concord，想让 coding agent 马上开始写第一批 Spec。新项目还没有代码，要从目标写起；已有项目有代码和测试，要从现有行为补写。维护者不必自己判断该读哪份说明，初始化结束时 Concord 直接给出对应的[写作指南](../../../concepts.md#writing-guide)。

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

2. 看到推荐的写作指南。 {#guide}

   init 根据仓库里有没有项目文件选出一份指南。以下为预期输出，人读输出的最后几行：

   ```text
   Start here: docs/concord.md
   Writing guide: concord --skill docs-from-code
   Inspect configuration: concord doctor
   ```

   `--json` 输出在 `guide` 字段给出同一个主题，字段定义见 [CLI](../../local-sdlc/cli.md#接入)。Herdr mod 在新建文件的数量下方显示同一条命令。

3. 让 agent 读指南。 {#read-guide}

   维护者把这条命令交给 agent，或自己运行：

   ```sh
   concord --skill docs-from-code
   ```

   输出是随安装包的指南正文，不读取项目，也不写文件。

4. 按指南写第一批 Spec，然后检查。 {#write}

   ```sh
   concord check
   ```

   每写完一批运行一次，逐个处理具名 finding。

## 选哪份指南

| 仓库情况 | 指南 | 从哪里写起 |
| --- | --- | --- |
| 除下面列出的文件外没有其它文件 | `docs-from-scratch` | 项目目标、品味与第一个 Feature，再实现 |
| 有其它文件，例如 `src/`、`package.json`、`go.mod` | `docs-from-code` | 现有的入口、命令、API 和测试，补写它们的行为 |

init 检查 Git 跟踪的文件与未被忽略的未跟踪文件。`docs/`、`memory/`、根目录的 `AGENTS.md`、`README*`、`LICENSE*`、`concord.config.ts` 以及以 `.` 开头的路径不算项目文件。`--dry-run init` 给出同样的推荐。

两份指南都能随时读取，与推荐无关。`concord --skill` 的入口也列出它们，以后再接入的 agent 不依赖 init 的输出。

## 从零写 Spec

`concord --skill docs-from-scratch` 引导 agent 按这个顺序写：

| 顺序 | 写什么 |
| ---: | --- |
| 1 | 和维护者确认项目给谁用、解决什么问题，写进 `docs/README.md` 开头。 |
| 2 | 把维护者确认过的判断标准写成 `docs/taste.md` 的条目，替换模板里的示例。 |
| 3 | 为第一项能力创建 Feature：README 像使用教程，上手示例标为预期输出。 |
| 4 | 每个用户目标写一个 Use Case，主流程步骤带 `{#id}`。 |
| 5 | 领域名词先进 `docs/concepts.md`，再出现在 Spec 里。 |
| 6 | 系统边界写进 `docs/architecture.md`；Feature 的内部设计在开始实现时写进它的 architecture 页。 |
| 7 | 实现时给源码加代码声明、给测试加标记，再把预期输出换成实际运行的输出。 |

## 为已有代码补写 Spec

`concord --skill docs-from-code` 引导 agent 按这个顺序写：

| 顺序 | 写什么 |
| ---: | --- |
| 1 | 盘点使用者能接触到的入口：命令、公开 API、页面、配置和现有测试，列出候选 Feature 交给维护者确认。 |
| 2 | 每批只写一个 Feature。行为页的示例来自实际运行，不凭阅读代码推测。 |
| 3 | 读不出意图的行为不写成规则，写成 Issue，由维护者决定它是需求还是缺陷。 |
| 4 | 给已有实现加代码声明，给已有测试加标记，让 `concord trace` 显示 Use Case 由哪些测试守护。 |
| 5 | 仓库原有的文档保留原文，其中仍然成立的内容并入对应 Feature，其它的留给维护者处理。 |
| 6 | 品味从代码中反复出现的取舍里提炼，经维护者确认后再写进 `docs/taste.md`。 |

## 结果

仓库完成初始化，agent 拿到适合这个项目的写作顺序。

| 情形 | 结果 |
| --- | --- |
| 初始化被拒绝，例如 `InitializationConflict` | 不输出指南，错误见[接入并取得模板](../../local-sdlc/use-case/onboard-from-template.md#结果) |
| 推荐与维护者的判断不同 | 直接读另一份指南，init 不需要重跑 |
| 未知的主题名 | `concord --skill` 返回 `SkillTopicUnknown` |

## Spec 来源

[目标与范围](../README.md)；命令与输出见 [CLI](../../local-sdlc/cli.md#接入)。
