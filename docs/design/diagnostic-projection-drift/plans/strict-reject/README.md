# strict-reject

## Problem

诊断投影在来源漂移下拒绝入库，刷新失败没有可区分的原因。

## Core Mental Model

保留现行规则：构建期间任何来源或发布代次变化都使候选拒绝入库。只补齐失败分类、值 Schema 与正文边界；首次投影依赖扫描窗口内没有编辑。

## Scope

改动失败分类、值 Schema 与正文边界，与 annotated-drift 的相应部分相同；不改变发布条件。接受的取舍：持续编辑的仓库可能长期没有投影，用户需要改用 `--fresh`。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-no-current-authority) | satisfied | 现状 | [架构](architecture.md) |
| [L2](../../LIMITS.md#l2-unknown-stays-unknown) | satisfied | 不发布不一致结果 | [架构](architecture.md) |
| [L3](../../LIMITS.md#l3-strict-decoding-and-identity) | satisfied | 补齐值 Schema | [架构](architecture.md) |
| [L4](../../LIMITS.md#l4-owner-bytes-stay-out-of-the-cache) | satisfied | 与 annotated-drift 相同的正文边界 | [架构](architecture.md) |
| [L5](../../LIMITS.md#l5-compatible-machine-output) | satisfied | 只新增错误码与字段 | [CLI](cli.md) |
| [L6](../../LIMITS.md#l6-bounded-refresh) | satisfied | 现状 | [架构](architecture.md) |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-first-projection-under-continuous-edits) | not-satisfied | 扫描窗口内的任何编辑都使首次投影失败；场景 C1 仍为 QueryPending | 场景 C1 |
| [G2](../../GOALS.md#g2-explainable-refresh-state) | satisfied | 具名失败码，另增 `QueryRefreshSourceChanged` 附变化路径 | 场景 C3、C4 |
| [G3](../../GOALS.md#g3-one-drift-semantics) | not-satisfied | 工作区发布漂移，诊断投影拒绝 | 场景 C5 |

## Entry Points

- [Library](library.md)
- [CLI](cli.md)
- [Architecture](architecture.md)
