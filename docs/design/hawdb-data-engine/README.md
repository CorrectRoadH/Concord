---
format: concord.document/v1
id: hawdb-data-engine
title: HawDB 接入与 SQLite 移除
createdAt: 2026-09-23T04:17:22.602Z
kind: design
alternatives:
  - native-embedded
  - keep-sqlite
decision:
  selected: native-embedded
  reason: 采用受限 HawDB 原生引擎，明确打开模式、资源预算、窄原生边界、发行条件与缓存清理的所有权。
  at: 2026-09-23T04:42:27.706Z
  targets:
    - docs/feature/local-data-engine/README.md
---

# HawDB 接入与 SQLite 移除

比较统一 HawDB 原生引擎和继续维护 SQLite/内存 Map。HawDB 候选包含短期解析缓存；来源 owner、证据和发布日志保持既有语义。方案采用以原生可行性和独立挑战为前提。

## Constitution

- [C-001](../../constitution.md#c-001)
- [C-002](../../constitution.md#c-002)
- [C-003](../../constitution.md#c-003)
- [C-004](../../constitution.md#c-004)
- [C-005](../../constitution.md#c-005)
- [C-006](../../constitution.md#c-006)
- [C-007](../../constitution.md#c-007)
- [C-008](../../constitution.md#c-008)
- [C-009](../../constitution.md#c-009)
- [C-012](../../constitution.md#c-012)
- [C-014](../../constitution.md#c-014)
