# keep-sqlite

## Problem

统一缓存与检索引擎必须保持本地事实和可安装性。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-source-ownership) | satisfied | 机制与约束见本页 | [研究依据](../../../../research/hawdb-integration/README.md) |
| [L2](../../LIMITS.md#l2-lifecycle-and-safety) | satisfied | 机制与约束见本页 | [研究依据](../../../../research/hawdb-integration/README.md) |
| [L3](../../LIMITS.md#l3-packaging-and-implementation) | satisfied | 机制与约束见本页 | [研究依据](../../../../research/hawdb-integration/README.md) |
| [L4](../../LIMITS.md#l4-bounded-behavior) | satisfied | 机制与约束见本页 | [研究依据](../../../../research/hawdb-integration/README.md) |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-unified-engine) | not-satisfied | 保留 SQLite 和 Map，不满足统一引擎目标 | 当前实现 |
| [G2](../../GOALS.md#g2-current-projections) | partial | 当前来源核验成立，但不是统一引擎投影 | 当前实现 |
| [G3](../../GOALS.md#g3-independent-installation) | satisfied | 机制与约束见本页 | [研究依据](../../../../research/hawdb-integration/README.md) |

## Mechanism

保留 node:sqlite 四个表与 ContentCache Map，现有安装不变，但不满足用户统一引擎的目标。
