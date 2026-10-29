# designs-as-spec

## Problem

维持现状：已裁决候选页继续作为现行 Spec 的一部分，Spec 以「见采用设计」链接引用。为减少混淆，给已裁决包加显著标注，并要求实现演进时同步修改候选页。

## Core Mental Model

被选中的候选页即现行规则；未选中的候选页是历史。

## Scope

只增加标注与维护约定，不迁移内容，不新增检查。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-一个事实一个-owner) | satisfied | 选中候选可以被明确指定为唯一 owner，其它页面只链接 | 设计推理 |
| [L2](../../LIMITS.md#l2-不改写历史记录) | pending | 随实现修改候选页需要先修订记录保存政策，并说明已被取代的候选内容如何失效 | 设计推理 |
| [L3](../../LIMITS.md#l3-路径即身份) | satisfied | 不移动文件 | 设计推理 |
| [L4](../../LIMITS.md#l4-宪法修订按程序采用) | pending | 需按程序提出并采用记录保存政策的修订；本候选尚未给出修订内容 | 设计推理 |
| [L5](../../LIMITS.md#l5-公开输出只增不改) | satisfied | 无输出变化 | 设计推理 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-现行规则只有一个-owner) | not-satisfied | 规则仍在候选页 | 设计推理 |
| [G2](../../GOALS.md#g2-读到现行规则所需的文档量显著减少) | not-satisfied | 读者仍需阅读被选中的候选页 | 设计推理 |
| [G3](../../GOALS.md#g3-规则由检查器强制) | not-satisfied | 同步修改只靠约定 | 设计推理 |
| [G4](../../GOALS.md#g4-决策仍可追溯) | satisfied | 不变 | 设计推理 |

## 第三方案：派生的现行规则视图

保留裁决快照，由工具从 Spec 聚合一份只读的现行规则视图并指回 owner。它解决导航与重复阅读，但不能代替把规则提升进 Spec；若需在现有 Spec 之外另行维护片段的适用性、取代链与 owner 映射，就会引入第二份归属登记（[C-001-3](../../../../constitution.md#c-001-3)）；若让片段本身作为唯一 owner，则需要另行改变当前的规则归属与引用规定。它可以作为 promote-to-spec 之后的检索能力另行考虑，本次不比较实现。

## Entry Points

- [Architecture](architecture.md)
