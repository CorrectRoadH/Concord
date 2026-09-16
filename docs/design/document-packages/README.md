---
format: concord.document/v1
id: document-packages
title: 文档目录与历史格式迁移
createdAt: 2026-09-15T00:28:03.335Z
kind: design
alternatives:
  - preserve-identities
  - keep-single-files
  - merge-topics
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-009
decision:
  selected: preserve-identities
  reason: 保留现有身份、历史来源与当前引用，Research统一目录并允许自由正文；独立设计挑战PASS。
  at: 2026-09-15T01:01:58.907Z
  targets:
    - docs/feature/document-packages/README.md
---

# 文档目录与历史格式迁移

NiceEval 已有的工程文档与规划因缺少当前 metadata 而未完整出现在 Concord 中。Research 的创建入口又固定生成单文件，并要求研究提纲。用户要求补齐原仓库格式迁移，并按文件夹自由组织研究。

当前目标由[文档目录与完整发现](../../feature/document-packages/README.md)拥有。本设计比较历史身份、路径、引用和目录体验之间的取舍。

- [目标](GOALS.md)与[共同约束](LIMITS.md)
- [固定场景](CASES.md)
- [保留身份并迁移目录](plans/preserve-identities/README.md)
- [仅改变新建默认值](plans/keep-single-files/README.md)
- [合并为顶层主题](plans/merge-topics/README.md)
- [裁决与依据](DECISION.md)
