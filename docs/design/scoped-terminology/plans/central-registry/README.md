# central-registry

## Problem

领域术语与写作政策需要明确作用域、严格结构与唯一来源。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-scope-and-identity) | not-satisfied | 目录拥有范围，聚合不复制定义 | 架构约束；不代表实现验收 |
| [L2](../../LIMITS.md#l2-publication-and-recovery) | satisfied | 操作/路径双向校验、CAS 和持久依赖摘要 | 架构约束；不代表实现验收 |
| [L3](../../LIMITS.md#l3-explicit-transition) | satisfied | 显式替换旧政策并修订 c-001 | 架构约束；不代表实现验收 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-local-ownership) | not-satisfied | 定义与使用范围归属一致 | 方案分析 |
| [G2](../../GOALS.md#g2-safe-authoring) | satisfied | 共用领域入口和摘要保护 | 方案分析 |

中央文件额外存 scope 会形成重复归属，且所有模块争用同一写入 owner。虽然可提供 CAS 和 Web，无法满足目录拥有局部事实的限制。
