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

维护者通过 Concord CLI 与 Web 在全局、Feature、Engineering 及其它 docs 子目录定义领域术语和写作写作规则。术语由 concepts.json 拥有结构化定义、稳定 ID、多语言名称、允许别名与弃用名称；写作规则由 concord-writing.json 拥有禁词和检查选项。所在目录决定局部作用域，全项目视图自动汇总并保留来源，不复制定义。

- [检查正文与术语](use-case/inspect-writing.md)
- [在 Web 管理写作与术语](use-case/manage-writing.md)
- [按目录管理结构化术语与写作写作规则](use-case/manage-scoped-terminology.md)
- [文件格式、作用域与迁移](policy.md)
- [采用设计](../../design/scoped-terminology/README.md)

写作写作规则使用 concord.writing/v2，术语使用 concord.concepts/v1。祖先规则按范围合成，局部来源不能扩大目录或静默覆盖定义。同名不同义按作用域区分；只对弃用名称派生禁词，允许别名不自动成为错误。

工具读写使用严格 Schema、整文件 CAS 与可恢复事务。show 支持无效来源显式修复；旧写作规则须作者审核后显式迁移，不在普通读取中兼容或猜测术语。Web 草稿和异步请求绑定具体 owner，保存一份来源不能把另一份草稿标成已保存。

检查报告表达某次已保存输入快照：包括禁词、长度、术语使用。发现问题退出 1，不自动修改正文，不声称实现完成或测试覆盖。Concord 不内置 NiceEval 产品词库、目录或 API 语义，产品专属检查留给消费者。结构关系继续使用 concord check。
