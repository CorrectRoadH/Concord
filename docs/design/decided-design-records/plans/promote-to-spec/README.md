# promote-to-spec

## Problem

裁决时把选中候选中的现行规则提升到 Spec，Design 包只作为决策记录保留。`concord check` 强制链接目标的边界，规则的完整归属由全量迁移核对验收。基准中已裁决的 27 个包一次性迁移。

## Core Mental Model

- 规则的 owner 由页面类别决定：行为写在行为页，实现写在 architecture 页，跨 Feature 边界写在项目 architecture，工程机制写在 engineering 页。
- Design 回答「当时为什么这样选」，Spec 回答「现在必须怎样」。两者之间只有 Spec 指向 Design README 或 DECISION 的依据链接。
- 检查器只看链接目标，不解析正文语义，规则可执行且无歧义。

详细机制见 [Architecture](architecture.md)。

## Scope

包含：`SpecDependsOnDesignRecord` finding、宪法 C-012 新增各款与对 C-012-5、C-012-6 的澄清、agent 指引与用户指南的阅读范围、27 个包的迁移。

不包含：Design 包体裁、Research/Roadmap/Memory/Issue 的链接规则、文件移动。

接受的取舍：迁移需要逐包对照代码核实，不能机械复制。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-一个事实一个-owner) | satisfied | 规则提升后只在 Spec 维护，Design 只作记录；检查器强制 Spec 不链接 Design 中的规则页 | 设计推理；迁移后由 C1、C3 验收 |
| [L2](../../LIMITS.md#l2-不改写历史记录) | satisfied | 迁移只改 Spec 页与链接，不改 Design 包 | 设计推理 |
| [L3](../../LIMITS.md#l3-路径即身份) | satisfied | 不移动文件 | 设计推理 |
| [L4](../../LIMITS.md#l4-宪法修订按程序采用) | satisfied | 已用 `concord constitution amend` 记录 C-012-7 至 C-012-10 及对 C-012-5、C-012-6 的补充 | [宪法 C-012](../../../../constitution.md#c-012) |
| [L5](../../LIMITS.md#l5-公开输出只增不改) | satisfied | 只新增 finding 代码 | 设计推理 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-现行规则只有一个-owner) | pending | 迁移与检查器 | 待 C1、C3 |
| [G2](../../GOALS.md#g2-读到现行规则所需的文档量显著减少) | pending | 默认阅读范围限于 Spec 页；提升时去重并精炼改写 | 固定 B0 = 725,232 B，预算 B1 ≤ 543,924 B；待迁移后计算 |
| [G3](../../GOALS.md#g3-规则由检查器强制) | pending | `concord check` 新增 `SpecDependsOnDesignRecord` finding | 待 C3、C5 |
| [G4](../../GOALS.md#g4-决策仍可追溯) | pending | 依据链接保留 | 待 C4 |

## Entry Points

- [Architecture](architecture.md)
