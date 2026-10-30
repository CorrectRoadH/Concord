---
format: concord.document/v1
id: constitution-2026-10-21-1
title: 允许显式 adapter 在执行时绑定并选择原生用例，同时明确静态关联扫描的禁止边界
createdAt: 2026-10-30T02:52:59.613Z
kind: memory
memoryKind: decision
state: current
epoch: 0
promotions:
  - docs/constitution.md
history: []
---

宪法修订，日期 2026-10-21。

## 理由

允许显式 adapter 在执行时绑定并选择原生用例，同时明确静态关联扫描的禁止边界

## 影响

第 1 款限定为静态关联扫描，第 3 款增加 adapter 执行例外；源码标记仍是唯一关联来源，原生观察不创建关联、不影响 check。旧收据保留原件，新执行语义重新取证。适用于 test-adapters 采用后的实现

## 来源

- `docs/design/test-adapters/README.md`
- `docs/design/test-journey-steps/共同身份.md`
