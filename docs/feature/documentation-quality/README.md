---
format: concord.document/v1
id: documentation-quality
title: 文档写作与一致性检查
createdAt: 2026-09-23T01:42:51.054Z
kind: feature
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-002
  - docs/constitution.md#c-004
  - docs/constitution.md#c-005
  - docs/constitution.md#c-006
  - docs/constitution.md#c-010
  - docs/constitution.md#c-007
  - docs/constitution.md#c-012
  - docs/constitution.md#c-003
  - docs/constitution.md#c-008
  - docs/constitution.md#c-009
---


# 文档写作与领域术语

维护者通过 Concord CLI 与 Web 在全局、Feature、Engineering 及其它 docs 子目录定义领域术语和写作规则。术语由 concepts.json 拥有结构化定义、稳定 ID、多语言名称、允许别名与弃用名称；写作规则由 concord-writing.json 拥有禁词和检查选项。所在目录决定局部作用域，全项目视图自动汇总并保留来源，不复制定义。

- [检查正文与术语](use-case/inspect-writing.md)
- [在 Web 管理写作与术语](use-case/manage-writing.md)
- [按目录管理结构化术语与写作规则](use-case/manage-scoped-terminology.md)
- [文件格式与作用域](policy.md)
- [采用设计](../../design/scoped-terminology/README.md)

写作规则使用 concord.writing/v2，术语使用 concord.concepts/v1。祖先规则按范围合成，局部来源不能扩大目录或静默覆盖定义。同名不同义按作用域区分；只对弃用名称派生禁词，允许别名不自动成为错误。

工具读写使用严格 Schema、整文件 CAS 与可恢复事务。show 支持无效来源显式修复。Web 草稿和异步请求绑定具体 owner，保存一份来源不能把另一份草稿标成已保存。

检查报告表达某次已保存输入快照，包括禁词、长度与术语使用。检查不自动修改正文，不声称实现合规、功能完成或测试覆盖。Concord 不内置产品专属词库、目录或 API 语义。

## 聚合门禁

`concord check` 是项目交付门禁，同时执行关系与生命周期检查和写作检查（[C-010](../../constitution.md#c-010)）。写作部分使用与 `concord docs check` 默认模式相同的文件选择与规则合成，不接受 `--rules`；独立 profile 与 `docs check --rules` 的结果不能替代门禁。

- 必查范围：按[默认文件选择规则](policy.md#写作政策)派生，即全部政策的有效 roots，加上没有同目录政策的概念目录；门禁不接受缩小该集合的参数。
- 必需规则：禁词、句长、段长与术语使用检查都参与门禁。项目可以调整阈值与词表，用 `exempt`、`allowIn` 与局部政策豁免具体位置；数字阈值为 null 或布尔选项为 false 表示项目采用的参数，门禁仍执行其余规则。
- 无政策：仓库没有任何写作政策与概念来源时，门禁报告 `WritingPolicyNotFound` 并失败。`concord init` 为新项目写入随包预设；已接入项目用 `concord writing set --path docs/concord-writing.json --expected-digest null` 保存政策后通过。
- 结果：JSON 的 `ok` 在全部检查无 finding 且输入完整时为 true。`complete` 为 false 表示关系图或写作输入不完整，包括政策缺失、无效、需要迁移和读取失败。每条 finding 带 `category`（`relation` 或 `writing`）与具名 code。`checks.relations` 与 `checks.writing` 分别给出 `ok` 与 `complete`。
- 退出码：`ok` 为 true 时退出 0，否则退出 1。输入不完整与违规通过 `complete` 和 finding code 区分。
- 入口一致：CLI `check`、结构化 action 与 Web 的项目检查使用同一聚合结果。

聚合门禁失败不阻断局部读取、`docs check`、`writing` 与 `concepts` 工具、author 与 page 编辑，以及修复所需的其它命令。
