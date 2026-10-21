---
format: concord.document/v1
id: typescript-native
title: TypeScript 原生编译器与受限输入生命周期
createdAt: 2026-10-21T12:14:52.411Z
kind: design
alternatives:
  - native-scopes
  - legacy-api
constitutionRefs:
  - docs/constitution.md#c-002
  - docs/constitution.md#c-003
  - docs/constitution.md#c-005
  - docs/constitution.md#c-007
  - docs/constitution.md#c-014
decision:
  selected: native-scopes
  reason: 采用固定输入与同步作用域的单一原生编译器；独立挑战无剩余阻断，实际行为与性能仍按C1–C6验收。
  at: 2026-10-21T12:21:05.575Z
  targets:
    - docs/feature/local-sdlc/README.md
    - docs/feature/project-onboarding/README.md
    - docs/feature/web-workbench/README.md
---

# TypeScript 原生编译器与受限输入生命周期

TypeScript 7.1 的编译器 API 通过包内原生子进程提供解析、诊断与模块解析。Concord 必须明确其输入与释放边界，同时保留配置静态读取、源码标记和 p5 的既有语义。

## Entry Points

- [Goals](GOALS.md)
- [Limits](LIMITS.md)
- [Cases](CASES.md)
- [Decision](DECISION.md)
- [受限作用域](plans/native-scopes/README.md)
- [保留旧编译器 API](plans/legacy-api/README.md)
