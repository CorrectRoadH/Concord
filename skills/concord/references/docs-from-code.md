# 为已有代码补写 Spec

适用于已经有代码、测试或旧文档的项目。目标是让 Spec 准确描述代码现在做什么，并把已有测试和实现关联到 Spec。Spec 只写确认过的行为：代码做了什么，以实际运行为准；该不该这样做，由维护者决定。

## 1. 盘点入口

列出使用者能接触到的入口：命令与参数、公开 API、页面、配置文件、环境变量和现有测试。按使用者想完成的事把它们分组，每组是一个候选 Feature。把候选清单交给维护者确认，再开始写。

## 2. 每批写一个 Feature

一次只写一个 Feature，写完运行 `concord check` 再写下一个：

```sh
concord new feature <name> --title "<标题>" --pages cli,use-case
```

README 写谁用、能做什么、上手示例；cli 或 library 页写完整调用、输出、退出码与错误。示例在临时目录实际运行后复制，不凭阅读代码推测输出；每次运行都会变的值写成省略号。

## 3. 不确定的行为写成 Issue

读不出意图的行为不写成规则，例如两个入口对同一输入结果不同、错误信息与文档矛盾、明显绕过检查的分支。把现象和复现命令写进 `docs/issues/<id>.md`，由维护者决定它是需求还是缺陷。确认为需求后再写进 Spec。

## 4. 关联已有测试与实现

每个 Use Case 主流程的步骤带 `{#id}`。给已有测试加标记，给实现加代码声明：

```sh
concord test marker --contract <use-case 路径>
concord code marker --contract <use-case 路径> --scope file
```

完整语法见 `concord --skill test` 与 `concord --skill code`。运行 `concord trace`，查看哪些 Use Case 还没有测试守护、哪些测试还没有关联 Spec。标记表示关联，不表示覆盖。

需要 `test run` 或修复核验时，在 `concord.config.ts` 配置 `runner`；测试或源码不在 `test/`、`tests/`、`src/` 时配置 `testRoots` 与 `sourceRoots`，见 `concord --skill init`。

## 5. 处理原有文档

init 保留仓库原有的文档原文。逐份阅读：仍然成立的内容并入对应 Feature 或 `docs/architecture.md`；过程记录、排障经过和经验写进 `memory/`；已经过时或拿不准的内容列给维护者处理，不自行删除。

## 6. 提炼品味和名词

代码和评审中反复出现的取舍，写成 `docs/taste.md` 的条目，经维护者确认后把 `status` 改为 `active`。代码里的领域名词写进 `docs/concepts.md`；同一概念在代码和文档里有几种写法时，选一种作为 term，其余写进“旧写法”，`concord docs check` 会找出它们。

页面写法的完整规则见 `concord --skill document`。
