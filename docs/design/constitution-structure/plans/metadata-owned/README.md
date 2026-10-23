# 元数据声明适用条款，正文链接只作导航

## Problem

保留 `constitutionRefs` 作为 owner 的规范性适用声明，同时校验正文链接。

## Core Mental Model

ID 语法、条款写法与宪法格式迁移与 link-owned 相同。`constitutionRefs` 保留，并允许指向款，是适用关系的唯一来源。正文链接同样由 `check` 校验，但只用于导航，不进入 `constitution show` 的适用关系。

## Scope

- 宪法格式迁移与 link-owned 相同；Feature 与 Design 元数据不迁移。
- `constitution show` 的适用关系仍从 `constitutionRefs` 派生，另列正文链接。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-运行时只接受当前格式) | satisfied | 宪法格式同样显式迁移 | 同 link-owned |
| [L2](../../LIMITS.md#l2-条款身份与修订历史保持) | satisfied | 同 link-owned | 同 link-owned |
| [L3](../../LIMITS.md#l3-迁移遵守写入契约) | satisfied | 同 link-owned，迁移范围只有宪法 | 同 link-owned |
| [L4](../../LIMITS.md#l4-破坏性变更经独立审查) | satisfied | 只改变 `constitution show` 输出，同一轮独立审查覆盖 | 独立审查第二轮结论 |
| [L5](../../LIMITS.md#l5-不改变测试与代码关联) | satisfied | 同 link-owned | 同 link-owned |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-引用精确到款且稳定) | satisfied | 同一 ID 语法 | CASES C1 |
| [G2](../../GOALS.md#g2-断开的引用被-check-发现) | satisfied | 元数据与正文链接都校验 | CASES C2、C7 |
| [G3](../../GOALS.md#g3-依据关系定位到句子且只声明一次) | not-satisfied | 适用关系只能声明在 Feature 与 Design owner 上，定位到 owner 而不是句子；附页无法声明。正文链接与元数据指向同一条款时含义不同，读者要分辨哪一个算依据 | CASES C12；本仓库 27 个链接文件中 22 个是附页 |
| [G4](../../GOALS.md#g4-宪法只写规则) | partial | 与 link-owned 相同的缺口 | CASES C8 由审阅判定 |
| [G5](../../GOALS.md#g5-用-concord-自己完成迁移与验收) | satisfied | 同 link-owned | 同 link-owned |

## Entry Points

本候选只有 README。
