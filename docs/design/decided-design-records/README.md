# 已裁决的 Design 只保留决策记录

## Problem

Concord 用 Design 包比较候选并裁决，用 Feature、architecture 与 engineering 页声明现行 Spec（[C-012](../../constitution.md#c-012)）。2026-10-29 盘点：29 个 Design 包共 624 KB、240 个文件，占 `docs/` 的 58%；Feature 页共 282 KB。27 个包已裁决，被选中候选的正文共约 302 KB，另有包根的共同支持页（例如 `docs/design/test-journey-steps/共同身份.md`）被多个 Use Case 当作规则引用。现行 Spec 中有 29 个页面、57 处链接指向 Design 包内页面（另有 2 处目录导航），其中一部分把完整的规则或验收委托给 Design，例如「规则见采用设计」「验收场景见 CASES」。

这带来三个问题：

1. 同一规则有两个可能的 owner，违背 [C-001](../../constitution.md#c-001-1)。读者无法从 Feature 页得知完整的现行行为，必须进入历史候选。
2. 候选页记录的是裁决时的设计。实现演进后，候选页与代码分叉，却仍被 Spec 当作规则引用。例如 [HawDB 引擎设计](../hawdb-data-engine/plans/native-embedded/README.md)仍规定持久句柄「不跨网络请求或 Web 空闲时间持有」，而这条规则正是 [CLI 热路径设计](../cli-hot-path/README.md)要推翻的错配来源。
3. agent 为了得到现行规则，要阅读 Spec 与它所依赖的 Design 页，合计约 0.72 MB，且无法区分哪些候选内容已被后续裁决取代。抽样的九个规则族中有三个已被后续裁决取代，却仍留在被引用的候选页里。

需要决定的是：已裁决的 Design 是决策记录还是现行 Spec 的一部分。

## Core Mental Model

- 决策记录：Design 包在裁决时的 Problem、Goals、Limits、Cases、候选与 Decision，说明当时为什么这样选。
- 现行规则：系统现在必须满足的行为与实现约束，只有一个 Spec owner。
- 提升：裁决时把选中候选中的现行规则改写进对应的 Spec 页，并以 Spec 页为准继续演进。

## Scope and Tradeoffs

范围：Design 与 Spec 的职责边界、两者之间的链接规则、`concord check` 的强制方式、agent 指引中的默认阅读范围，以及 27 个已裁决包的一次性迁移。

不在范围：Research、Roadmap、Memory 与 Issue 的职责（它们可以链接任何页面）；Design 包内部的体裁规则；删除或移动已有文件（路径是身份，迁移不改路径）。

取舍：迁移需要逐包核对代码与候选正文，工作量大；换来的是现行规则只有一个 owner。检查器强制链接目标的边界，规则的完整归属由全量迁移核对验收。

## 宪法修订提案

在 [C-012](../../constitution.md#c-012) 增加以下各款，每款一项规则，ID 从 `c-012-7` 起按实际采用新增：

> 7. 已裁决 Design 的候选、共同约束、验收与裁决正文是裁决时的方案记录，不作为现行 Spec 的 owner。
>
> 8. 裁决时，选中方案中仍适用的要求完整写入相应的行为页、architecture 页或工程页；此后这些要求在 Spec 中维护，不因实现尚未满足而丢弃。
>
> 9. Design 不为追随实现改写历史方案。经授权的理由更正与内容组织调整，仍遵守已有的来源保留、身份与生命周期规则。
>
> 10. Spec 对 Design 的引用只用于导航或说明决策依据；链接目标的检查范围由 documentation-quality 的聚合门禁声明。

同时在 [C-012-5](../../constitution.md#c-012-5) 补一句：现行句式要求不把 Design 的历史方案记录解释为当前要求；[C-012-6](../../constitution.md#c-012-6) 链接新增各款，不删除其历史保护。C-001 与 C-011 无需修改：同一字句作为历史提案与作为现行义务是两项不同的事实；提升后的行为与不变量仍按 C-011 关联到 Feature、Use Case 或 architecture 锚点。

- 适用范围：`docs/` 下 Feature 包、项目 `architecture.md`、宪法、engineering 页与 docs 顶层页面对 Design 包的引用。
- 理由与来源：本页 Problem 一节的盘点与独立审查的抽样核实。
- 影响：现有依赖链接与委托语句按迁移计划改写；`concord check` 新增 finding；agent 指引的默认阅读范围收窄。

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
