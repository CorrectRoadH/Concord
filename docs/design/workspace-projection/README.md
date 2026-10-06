---
format: concord.document/v1
id: workspace-projection
title: 工作区只读投影
createdAt: 2026-09-29T05:54:31.477Z
kind: design
alternatives:
  - shared-projection
  - web-only
  - sync-scan
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-007
  - docs/constitution.md#c-013
  - docs/constitution.md#c-014
decision:
  selected: shared-projection
  reason: 工作台与显式 CLI 缓存入口共享服务端维护的结构投影；当前查询和定向编辑保留严格前像。独立 Opus 5.5 设计挑战 PASS，采用单一路径、漂移标注、独立配额和显式恢复。
  at: 2026-09-29T06:25:49.829Z
  targets:
    - docs/feature/web-workbench/README.md
---

# 工作区只读投影

## Problem

`concord view` 的工作区导航不能依赖请求内的全项目扫描：来源文件在扫描期间变化时，乐观快照会拒绝返回，普通编辑就会使工作台加载失败。需要确定展示投影的读取、刷新和失效方式，并保留当前事实查询与写入保护。

## Core Mental Model

工作区展示是可重建的派生视图，来源文件仍是事实 owner。展示可以报告构建区间、完成性和刷新状态；它不能授权写入、恢复、检查或证据裁决。CLI 的当前来源查询与显式展示投影是两种不同语义。

## Scope and Tradeoffs

比较 Web 与 CLI 是否共享投影、来源连续变化时能否提供导航、owner 正文是否进入缓存，以及服务进程和一次性 CLI 的刷新所有权。保留 `workspace show` 当前来源语义。选中方案须满足全部 Limits 与宪法 [C-014.4](../../constitution.md#c-014) 的历史投影边界。

## Entry Points

- [目标](GOALS.md)
- [约束](LIMITS.md)
- [场景](CASES.md)
- [裁决](DECISION.md)
- [共享结构投影](plans/shared-projection/README.md)
- [Web 专属投影](plans/web-only/README.md)
- [同步扫描](plans/sync-scan/README.md)
