---
format: concord.document/v1
id: decided-design-records
title: 已裁决的 Design 只保留决策记录
createdAt: 2026-10-29T13:52:47.968Z
kind: design
alternatives:
  - promote-to-spec
  - designs-as-spec
---

# 已裁决的 Design 只保留决策记录

## Problem

Concord 用 Design 包比较候选并裁决，用 Feature、architecture 与 engineering 页声明现行 Spec（[C-012](../../constitution.md#c-012)）。2026-10-29 盘点：29 个 Design 包共 624 KB、240 个文件，占 `docs/` 的 58%；Feature 页共 282 KB。28 个包已裁决，被选中候选的正文共约 302 KB。现行 Spec 中有 29 个文件、56 处链接指向 Design 页，其中大多是「规则见采用设计」「验收场景见 CASES」，即现行规则与验收只写在已裁决的候选页里。

这带来三个问题：

1. 同一规则有两个可能的 owner，违背 [C-001](../../constitution.md#c-001-1)。读者无法从 Feature 页得知完整的现行行为，必须进入历史候选。
2. 候选页记录的是裁决时的设计。实现演进后，候选页与代码分叉，却仍被 Spec 当作规则引用。例如 [HawDB 引擎设计](../hawdb-data-engine/plans/native-embedded/README.md)仍规定持久句柄「不跨网络请求或 Web 空闲时间持有」，而这条规则正是 [CLI 热路径设计](../cli-hot-path/README.md)要推翻的错配来源。
3. agent 为了得到现行规则，要阅读的文档量从约 0.4 MB 扩大到约 1.1 MB，且无法区分哪些候选内容仍然有效。

需要决定的是：已裁决的 Design 是决策记录还是现行 Spec 的一部分。

## Core Mental Model

- 决策记录：Design 包在裁决时的 Problem、Goals、Limits、Cases、候选与 Decision，说明当时为什么这样选。
- 现行规则：系统现在必须满足的行为与实现约束，只有一个 Spec owner。
- 提升：裁决时把选中候选中的现行规则改写进对应的 Spec 页，并以 Spec 页为准继续演进。

## Scope and Tradeoffs

范围：Design 与 Spec 的职责边界、两者之间的链接规则、`concord check` 的强制方式、agent 指引中的默认阅读范围，以及 28 个已裁决包的一次性迁移。

不在范围：Research、Roadmap、Memory 与 Issue 的职责（它们可以链接任何页面）；Design 包内部的体裁规则；删除或移动已有文件（路径是身份，迁移不改路径）。

取舍：迁移需要逐包核对代码与候选正文，工作量大；换来的是现行规则只有一个 owner，且由检查器保证不再回退。

## 宪法修订提案

在 [C-012](../../constitution.md#c-012) 增加一款：

> 已裁决的 Design 是决策记录。裁决时，选中候选中的现行规则写入相应的行为页、architecture 页或工程页，此后只在这些页面维护；Design 包保留裁决时的内容，不随实现演进改写。Spec 页面只把 Design 的 README 或 DECISION 链接为决策依据，不依赖候选页、CASES、GOALS 或 LIMITS 中的规则与验收。

- 适用范围：`docs/` 下的 Feature 包、项目 `architecture.md`、宪法与 engineering 页对 Design 包的引用。
- 理由与来源：本页 Problem 一节的盘点。
- 影响：现有 56 处链接按迁移计划改写；`concord check` 新增 finding；agent 指引的默认阅读范围收窄。

修订由 `concord constitution amend` 记录（[C-008](../../constitution.md#c-008-2)）。

## Entry Points

- [Goals](GOALS.md)
- [Limits](LIMITS.md)
- [Cases](CASES.md)
- [Decision](DECISION.md)
- 候选：[promote-to-spec](plans/promote-to-spec/README.md)、[designs-as-spec](plans/designs-as-spec/README.md)

## Constitution

- [C-001](../../constitution.md#c-001)
- [C-008](../../constitution.md#c-008)
- [C-012](../../constitution.md#c-012)
- [C-015](../../constitution.md#c-015)
