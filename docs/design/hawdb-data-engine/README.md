---
format: concord.document/v1
id: hawdb-data-engine
title: HawDB 接入与 SQLite 移除
createdAt: 2026-09-23T04:17:22.602Z
kind: design
alternatives:
  - native-embedded
  - keep-sqlite
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-002
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-005
  - docs/constitution.md#c-006
  - docs/constitution.md#c-007
  - docs/constitution.md#c-008
  - docs/constitution.md#c-009
  - docs/constitution.md#c-012
decision:
  selected: native-embedded
  reason: 独立 Astra CONDITIONAL 的打开模式、预算、窄原生例外和发行边界已落实；clear 子方案 PASS，原型证据与实现后验收明确分离
  at: 2026-09-23T04:42:27.706Z
  targets:
    - docs/feature/local-data-engine/README.md
---

# HawDB 接入与 SQLite 移除

比较统一 HawDB 原生引擎和继续维护 SQLite/内存 Map。HawDB 候选包含短期解析缓存；来源 owner、证据和发布日志保持既有语义。方案采用以原生可行性和独立挑战为前提。
