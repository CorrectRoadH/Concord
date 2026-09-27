---
format: concord.document/v1
id: constitution-refs-immutable
title: 既有 owner 无法修改 constitutionRefs
createdAt: 2026-09-27T02:11:48.229Z
kind: issue
state: draft
memoryRelations: []
adoptions:
  current: []
  history: []
history: []
---

# 既有 Feature/Design 无法修改 constitutionRefs

`constitutionRefs` 只能在 `feature create` / `design create` 时通过 `--constitution-ref` 设置。宪法新增条款（如 C-014）后，既有 owner 无法用具名命令追加或移除引用，`author set` 与 `page set` 保留 metadata，而 C-012 禁止手改 owner metadata。

期望：提供带 digest 保护的具名命令维护 constitutionRefs，并校验 anchor 存在。
