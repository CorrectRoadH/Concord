---
format: concord.document/v1
id: constitution-2026-10-29-1
title: 采用 link-owned 宪法结构：条款与款使用 {#id}，依据关系由正文链接拥有；总则新增条款写法，正文的序号…
createdAt: 2026-10-30T02:53:01.498Z
kind: memory
memoryKind: decision
state: current
epoch: 0
promotions:
  - docs/constitution.md
history: []
---

宪法修订，日期 2026-10-29。

## 理由

采用 link-owned 宪法结构：条款与款使用 {#id}，依据关系由正文链接拥有；总则新增条款写法，正文的序号引用改为链接

## 影响

取消 Feature 与 Design 的 constitutionRefs，依据关系改由 docs 下的正文链接表达并由 check 校验；C-008 第 4 款改为按 ID 维护身份；迁移不改变既有规则含义，不声称现有页面符合条款写法

## 来源

- `docs/design/constitution-structure/README.md`
