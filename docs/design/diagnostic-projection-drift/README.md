---
format: concord.document/v1
id: diagnostic-projection-drift
title: 诊断投影的漂移发布与刷新失败分类
createdAt: 2026-10-06T04:31:50.113Z
kind: design
alternatives:
  - annotated-drift
  - strict-reject
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-004
  - docs/constitution.md#c-013
  - docs/constitution.md#c-014
  - docs/constitution.md#c-015
decision:
  selected: annotated-drift
  reason: 诊断投影与工作区导航采用同一 observeProjection 原语、漂移分拣与替换规则；漂移结果诚实标注后可作为首份投影，失败具名并保留 scannedAt。独立 Opus 5.5 审查两轮，阻断项已修订。
  at: 2026-10-06T05:02:52.646Z
  targets: []
---

# 诊断投影的漂移发布与刷新失败分类

## Problem

`trace show`、`trace gaps` 与 `review render` 默认读取后台刷新的诊断投影。刷新扫描期间只要来源或发布代次变化，结果就整体拒绝入库；扫描超出刷新上限时被终止，错误只剩一条泛化消息。持续编辑的大仓库因此可能永远没有第一份投影，CLI 每次都返回 QueryPending，用户也无法从输出判断原因。工作区导航投影已经允许发布诚实标注漂移的代次，两类投影对同一种来源变化给出相反的处理。

需要决定诊断投影遇到来源漂移时是否发布、发布什么、如何标注，以及刷新失败如何具名分类；同时补齐投影值的严格解码与 owner 正文边界。刷新扫描本身的耗时优化由性能测量定位后单独处理，不在本决定内。

## Core Mental Model

诊断投影是某次扫描在构建区间内观察到的结构结果。`consistent` 只回答"构建期间观察到的来源是否保持不变"，与扫描自身的 `complete`、findings 语义分开。投影永远标为 `current: false`；不一致的投影把缺失关系和零 gap 标为未知，不能写成"没有问题"。

刷新失败分为可重试的身份变化、超时、输出超限、恢复待处理与扫描具名失败。失败只追加到同一条记录，不淘汰已有投影。

## Scope and Tradeoffs

比较两种处理：拒绝漂移结果、只补齐失败分类（`strict-reject`），与按工作区协议发布标注漂移的投影（`annotated-drift`）。范围包括投影记录格式、刷新扫描入口、扫描内漂移 finding 的分拣、替换规则、JSON 输出字段、人类输出提示、失败码与正文边界。check、trace check、`--fresh` 当前来源查询、写入、恢复与证据裁决的语义不变。

[读取异步刷新的诊断投影](../../feature/local-data-engine/use-case/query-asynchronous-projections.md)拥有入库条件、`projection` 字段、失败码与刷新上限的测量对象。

[性能验收](../../engineering/concord-self-hosting/performance.md)拥有 `bench query` 的刷新测量定义与 `scale` 消费者的判定方法。

## Entry Points

- [目标](GOALS.md)
- [约束](LIMITS.md)
- [场景](CASES.md)
- [裁决](DECISION.md)
