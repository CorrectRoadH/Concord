---
format: concord.document/v1
id: documentation-quality
title: 文档写作与一致性检查
kind: feature
---

# 文档写作与领域术语

维护者通过 Concord CLI 与 Web 在全局、Feature、Engineering 及其它 docs 子目录定义领域术语和写作规则。术语由 concepts.md 拥有：每个概念有稳定 ID、唯一写法、定义段落与解释，旧写法列为弃用名；写作规则由 concord-writing.json 拥有禁词和检查选项。所在目录决定局部作用域，全项目视图自动汇总并保留来源，不复制定义。

- [应用受控写作规则](use-case/apply-controlled-writing.md)
- [检查正文与术语](use-case/inspect-writing.md)
- [在 Web 管理写作与术语](use-case/manage-writing.md)
- [按目录管理结构化术语与写作规则](use-case/manage-scoped-terminology.md)
- [文件格式与作用域](policy.md)
- [实现](architecture.md)

写作规则使用 concord.writing/v3；术语使用 concepts.md 的标题结构，不设版本字段。祖先规则按范围合成，局部来源不能扩大目录或静默覆盖定义。同名不同义按作用域区分；弃用名称派生禁词并建议改为该概念的写法。正文可以链接到 `concepts.md#id`，断开的链接由检查报告。

工具读写使用严格 Schema、整文件 CAS 与可恢复事务。show 支持无效来源显式修复。Web 草稿和异步请求绑定具体 owner，保存一份来源不能把另一份草稿标成已保存。

检查报告表达某次已保存输入快照，包括禁词、字符长度、受控 token 长度、显式启用的词法规则与术语使用。检查不自动修改正文，不声称实现合规、功能完成或测试覆盖。Concord 不内置产品专属词库、目录或 API 语义。

## 聚合门禁

`concord check` 是项目交付门禁，同时执行关系与生命周期检查和写作检查（[C-010](../../constitution.md#c-010)）。写作部分使用与 `concord docs check` 默认模式相同的文件选择与规则合成，不接受 `--rules`；独立 profile 与 `docs check --rules` 的结果不能替代门禁。

- 必查范围：按[默认文件选择规则](policy.md#写作政策)派生，即全部政策的有效 roots，加上没有同目录政策的概念目录；门禁不接受缩小该集合的参数。
- 必需规则：禁词、字符句长与段长、受控 token 句长与段落句数、显式启用的词法规则及术语使用检查都参与门禁。项目可以调整阈值与词表，用 `exempt`、`allowIn` 与局部政策豁免具体位置；数字阈值为 null 或布尔选项为 false 表示项目采用的参数，门禁仍执行其余规则。
- 无政策：仓库没有任何写作政策与概念来源时，门禁报告 `WritingPolicyNotFound` 并失败。`concord init` 为新项目写入随包预设；已接入项目用 `concord writing set --path docs/concord-writing.json --expected-digest null` 保存政策后通过。
- 结果：JSON 的 `ok` 在全部检查无 finding 且输入完整时为 true。`complete` 为 false 表示关系图或写作输入不完整，包括政策缺失、无效、需要迁移和读取失败。每条 finding 带 `category`（`relation` 或 `writing`）与具名 code。`checks.relations` 与 `checks.writing` 分别给出 `ok` 与 `complete`。
- 退出码：`ok` 为 true 时退出 0，否则退出 1。输入不完整与违规通过 `complete` 和 finding code 区分。
- 入口一致：CLI `check`、结构化 action 与 Web 的项目检查使用同一聚合结果。
- Design 记录边界：Spec 页面链接到 Design 包内除 README 与 DECISION 以外的页面时，报告 relation 类 finding `SpecDependsOnDesignRecord`，带来源路径、原始行号与链接目标（[C-012-10](../../constitution.md#c-012-10)）。

Spec 页面指 Feature 包、项目 `architecture.md`、宪法、engineering 页与 docs 顶层页面。`docs/design/`、`docs/research/`、`docs/roadmap/`、`docs/issues/`、`docs/_template/` 与 Memory 来源不受此限。

该检查覆盖行内与引用式链接，目标解码并规范化后比较，锚点不改变结果；图片、代码、HTML 注释、frontmatter 与 MDX 非正文源码不计。来源无法读取或解析时 `complete` 为 false。它只约束链接目标，不判断正文是否仍把规则委托给 Design。

聚合门禁失败不阻断局部读取、`docs check`、`writing` 与 `concepts` 工具、author 与 page 编辑，以及修复所需的其它命令。

## Constitution

- [C-001](../../constitution.md#c-001)
- [C-002](../../constitution.md#c-002)
- [C-004](../../constitution.md#c-004)
- [C-005](../../constitution.md#c-005)
- [C-006](../../constitution.md#c-006)
- [C-007](../../constitution.md#c-007)
- [C-012](../../constitution.md#c-012)
- [C-003](../../constitution.md#c-003)
- [C-008](../../constitution.md#c-008)
- [C-009](../../constitution.md#c-009)
