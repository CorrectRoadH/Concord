# json-single-term

## Problem

保留 JSON 来源，只把名称模型收敛为单一写法。

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-single-spelling) | satisfied | 概念为 `{ id, term, definition, deprecated }` | 方案分析 |
| [G2](../../GOALS.md#g2-co-located-explanation) | not-satisfied | 定义仍在 JSON，解释仍在另一份 Markdown；正文没有可链接的定义锚点 | 方案分析 |
| [G3](../../GOALS.md#g3-safe-authoring) | satisfied | 沿用 `concepts set` 的整文件 CAS 与字段表单 | 方案分析 |

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-scope-and-identity) | satisfied | 文件名与目录不变 | 沿用目录归属方案 |
| [L2](../../LIMITS.md#l2-publication-and-recovery) | satisfied | 路径不变，单文件 `set-concepts` 足以迁移 | 方案分析 |
| [L3](../../LIMITS.md#l3-explicit-transition) | satisfied | 每个 catalog 由作者审阅后 set 为 v2 | 方案分析 |
| [L4](../../LIMITS.md#l4-strict-structure) | satisfied | 严格 Schema 解码 | 方案分析 |

## 方案

`concord.concepts/v2` 的概念为 `id`、`term`、`definition` 与可选 `deprecated`，去掉按语言分组和 `aliases`。文件仍为 `concepts.json`，因此 imports 路径不变，迁移可以逐个 catalog 用现有 `set-concepts` 完成，不需要删除文件的事务。

改动面最小，但定义与解释仍分处两个文件，正文无法链接到一条定义，定义里也不能写链接。G2 是本设计要解决的问题之一，因此不采用。
