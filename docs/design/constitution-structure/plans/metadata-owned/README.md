# 元数据声明适用条款，正文链接另行校验

## Problem

保留 `constitutionRefs` 作为“适用条款”的显式声明，同时校验正文链接。

## Core Mental Model

ID 语法、条款写法、迁移宪法格式与 link-owned 相同。`constitutionRefs` 保留，并允许指向款。正文链接同样由 `check` 校验，但只作引用，不进入 `constitution show` 的依据关系。

## Scope

- 宪法格式迁移与 link-owned 相同；Feature 与 Design 元数据不迁移。
- `constitution show` 的依据关系仍从 `constitutionRefs` 派生，新增正文引用列表。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-运行时只接受当前格式) | satisfied | 宪法格式同样显式迁移 | 同 link-owned |
| [L2](../../LIMITS.md#l2-条款身份与修订历史保持) | satisfied | 同 link-owned | 同 link-owned |
| [L3](../../LIMITS.md#l3-迁移遵守写入契约) | satisfied | 同 link-owned，迁移范围只有宪法 | 同 link-owned |
| [L4](../../LIMITS.md#l4-破坏性变更经独立审查) | pending | 只改变 `constitution show` 输出，破坏面较小；仍需审查 | 审查尚未完成 |
| [L5](../../LIMITS.md#l5-不改变测试与代码关联) | satisfied | 同 link-owned | 同 link-owned |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-引用精确到款且稳定) | satisfied | 同一 ID 语法 | C1 |
| [G2](../../GOALS.md#g2-断开的引用被-check-发现) | satisfied | 元数据与正文链接都校验 | C2、C7 |
| [G3](../../GOALS.md#g3-依据关系只有一个-owner) | not-satisfied | 同一依据关系可以在元数据与正文各写一次，两者可能不一致；反向视图只看元数据 | 现状：36 个 owner 的元数据与 27 个文件的正文链接并存 |
| [G4](../../GOALS.md#g4-宪法只写规则) | partial | 与 link-owned 相同的缺口 | C8 由审阅判定 |
| [G5](../../GOALS.md#g5-用-concord-自己完成迁移与验收) | satisfied | 同 link-owned | 同 link-owned |
