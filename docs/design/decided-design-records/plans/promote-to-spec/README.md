# promote-to-spec

## Problem

裁决时把选中候选中的现行规则提升到 Spec，Design 包只作为决策记录保留；`concord check` 禁止 Spec 依赖候选页，使这条边界不会回退。已裁决的 28 个包一次性迁移。

## Core Mental Model

- 规则的 owner 由页面类别决定：行为写在行为页，实现写在 architecture 页，跨 Feature 边界写在项目 architecture，工程机制写在 engineering 页。
- Design 回答「当时为什么这样选」，Spec 回答「现在必须怎样」。两者之间只有 Spec 指向 Design README 或 DECISION 的依据链接。
- 检查器只看链接目标，不解析正文语义，规则可执行且无歧义。

详细机制见 [Architecture](architecture.md)。

## Scope

包含：`SpecDependsOnDesignRecord` finding、宪法 C-012 新增一款、agent 指引与用户指南的阅读范围、28 个包的迁移。

不包含：Design 包体裁、Research/Roadmap/Memory/Issue 的链接规则、文件移动。

接受的取舍：迁移需要逐包对照代码核实，不能机械复制。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-一个事实一个-owner) | pending | 规则提升后只在 Spec 维护；检查器禁止 Spec 依赖候选页 | 待迁移后 C1、C3 |
| [L2](../../LIMITS.md#l2-不改写历史记录) | satisfied | 迁移只改 Spec 页与链接，不改 Design 包 | 设计推理 |
| [L3](../../LIMITS.md#l3-路径即身份) | satisfied | 不移动文件 | 设计推理 |
| [L4](../../LIMITS.md#l4-宪法修订按程序采用) | pending | 用 `concord constitution amend` 记录 | 待执行 |
| [L5](../../LIMITS.md#l5-公开输出只增不改) | satisfied | 只新增 finding 代码 | 设计推理 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-现行规则只有一个-owner) | pending | 迁移与检查器 | 待 C1、C3 |
| [G2](../../GOALS.md#g2-读到现行规则所需的文档量减半) | pending | 默认阅读范围限于 Spec 页 | 现状约 0.41 MB / 1.08 MB；迁移会增加 Spec 字节数，待复测 |
| [G3](../../GOALS.md#g3-规则由检查器强制) | pending | `concord check` 新增 `SpecDependsOnDesignRecord` finding | 待 C3、C5 |
| [G4](../../GOALS.md#g4-决策仍可追溯) | pending | 依据链接保留 | 待 C4 |

## Entry Points

- [Architecture](architecture.md)
