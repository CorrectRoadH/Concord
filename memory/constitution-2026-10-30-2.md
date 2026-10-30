---
format: concord.document/v1
id: constitution-2026-10-30-2
title: 宪法与声明式 owner 只保存当前声明
createdAt: 2026-10-30T02:53:05.326Z
kind: memory
memoryKind: decision
state: current
epoch: 0
promotions:
  - docs/constitution.md
  - docs/constitution.md#c-012-11
history: []
---

宪法修订，日期 2026-10-30。

## 理由

docs 只写声明。宪法与 Feature、Use Case、Engineering 这类声明式 owner 只保存当前规则；修订记录、创建时间与采用来源属于历史，归 Memory、Git 或记录类 owner。

## 影响

C-008-2 改为由 `constitution amend` 在同一次发布中写入 Decision Memory；C-012-6 只为记录类 owner 保留工具维护的生命周期元数据；新增 C-012-11。宪法 frontmatter 只剩 format 与 status，声明式 owner 不再含 createdAt、createdAtSource 与 origin。

## 来源

- `docs/feature/project-onboarding/use-case/evolve-constitution.md`
- `docs/feature/local-sdlc/library.md`
