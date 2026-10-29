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
| [L1](../../LIMITS.md#l1-一个事实一个-owner) | not-satisfied | 规则在 Spec 与候选页之间拆分，候选页同时是记录与规则 | Problem 一节盘点：56 处依赖链接 |
| [L2](../../LIMITS.md#l2-不改写历史记录) | not-satisfied | 要求随实现修改候选页，等于改写裁决时的记录 | [C-012-6](../../../../constitution.md#c-012-6) |
| [L3](../../LIMITS.md#l3-路径即身份) | satisfied | 不移动文件 | 设计推理 |
| [L4](../../LIMITS.md#l4-宪法修订按程序采用) | satisfied | 无需修订 | 设计推理 |
| [L5](../../LIMITS.md#l5-公开输出只增不改) | satisfied | 无输出变化 | 设计推理 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-现行规则只有一个-owner) | not-satisfied | 规则仍在候选页 | 设计推理 |
| [G2](../../GOALS.md#g2-读到现行规则所需的文档量减半) | not-satisfied | 读者仍需阅读被选中的候选页 | 设计推理 |
| [G3](../../GOALS.md#g3-规则由检查器强制) | not-satisfied | 同步修改只靠约定 | 设计推理 |
| [G4](../../GOALS.md#g4-决策仍可追溯) | satisfied | 不变 | 设计推理 |

## Entry Points

- [Architecture](architecture.md)
