# 初始化后开始写 Spec

## 用户目标

维护者刚接入 Concord，想让 coding agent 结合本次需求和仓库现状写出可读的 Spec。仓库有代码不代表只能补写现状；补写与新增需求可以同时进行。init 提供写作入口，agent 沿用对话中的明确目标，只询问影响范围或正确性的未决问题。

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

4. agent 确定本次写作范围。 {#ask}

   agent 读取用户请求、项目说明、已有 Spec、品味与术语，再按需检查源码和测试。已有明确方向时直接推进；只有目标不清楚时才提出具体建议并询问（以下为预期输出）：

   ```text
   这是一个已有阅读界面和旧设计文档的项目。我建议先整理“打开书籍并继续阅读”这条路径。
   这次主要整理已有功能，还是还有要一起设计的新需求？
   ```

   未决目标不写成既定规则；不依赖回答的调查和已授权写作继续进行。不要求维护者重复选择指南或逐批确认。

5. agent 读写作指南与完整示例，写 Spec，然后检查。 {#write}

   | 本次任务 | agent 读的指南 |
   | --- | --- |
   | 从零写 | `concord --skill docs-from-scratch` |
   | 为已有代码补写 | `concord --skill docs-from-code`，完整路径见[为已有代码补写 Spec 并纳管存量测试](document-existing-code.md) |

   `concord --skill document` 同时输出写作规则与 [Spec 写作示例](../../../guides/spec-examples.md)。示例正文由 docs 拥有，随安装包提供；agent 无需找到安装目录或访问 Concord 源仓库。示例是虚构产品的写法，不是接入项目的需求。

   agent 先完成代表性 Feature 的 README 与一条 Use Case，按实际入口写操作和可观察结果，核对每步都服务同一个用户目标，再扩写其余范围。源码标记不作为正文完成的条件（[先有用户故事](../../../taste.md#t-14)）。交付前运行：

   ```sh
   concord check
   ```

   逐个处理本次改动引入的 finding，报告其余问题；结构检查不代替正文审阅。

## 两份写作指南

[写作指南](../../../concepts.md#writing-guide)随时都能读取，与 init 无关；`concord --skill` 的入口也列出它们，以后再接入的 agent 不依赖 init 的输出。

`docs-from-scratch` 引导 agent 从用户目标写 Spec：

| 顺序 | 写什么 |
| ---: | --- |
| 1 | 沿用已明确的用户、目标与范围，阅读完整示例；关键歧义才询问。 |
| 2 | 读取或补齐相关术语、品味与系统边界，保留既有有效决策。 |
| 3 | 先写代表性 README 和一条用户路径，结果尚未验证时标为预期结果。 |
| 4 | 按读者需要补充 UI、API、CLI、架构等页面，检查正文和引用。 |
| 5 | 交付 Spec；仅在实现也获授权时，继续按实现指南开发与关联。 |

`docs-from-code` 引导 agent 从已有证据补写：

| 顺序 | 写什么 |
| ---: | --- |
| 1 | 先读项目说明与相关旧文档，再按用户目标查入口、源码和测试；沿用已确定的范围。 |
| 2 | 参照完整示例写代表性 Feature 与 Use Case，先审阅正文再扩写。 |
| 3 | 区分已验证行为、预期结果与存疑观察；代码与既有约定冲突时记 Issue，不自动采用代码作为规则。 |
| 4 | 文档路径与语义稳定后，按接入范围关联真正对应的实现与测试；允许保留缺口。 |
| 5 | 只写文档的任务不修改源码、测试或运行配置；交付范围与未验证项如实说明。 |

## 结果

仓库完成初始化，agent 按本次目标写 Spec，并用随包示例校准正文。

| 情形 | 结果 |
| --- | --- |
| 初始化被拒绝，例如 `InitializationConflict` | 不输出下一步，错误见[接入并取得模板](../../local-sdlc/use-case/onboard-from-template.md#结果) |
| 用户已要求为已有代码补写 | 直接读 `docs-from-code`，不重复询问二选一 |
| 已有代码，但维护者要推倒重写 | 按明确的新目标读 `docs-from-scratch`，旧代码只作为调查材料 |
| 补写过程中追加新需求 | 只调查新增需求依赖的现状，按 `concord --skill spec` 写目标，不等待整仓补写或标记完成 |
| 只要求写 Spec | 交付文档，不自动进入实现或修改测试与配置 |
| 写到一半想换路径 | 直接读另一份指南，init 不需要重跑 |
| 未知的 skill 主题 | `concord --skill` 返回 `SkillTopicUnknown` |

## Spec 来源

[目标与范围](../README.md)；命令与输出见 [CLI](../../local-sdlc/cli.md#接入)。
