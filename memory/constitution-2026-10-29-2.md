---
format: concord.document/v1
id: constitution-2026-10-29-2
title: 文档只有一个主语言，每个概念只需要一个写法；领域术语改由按目录归属的 concepts.md 拥有，定义与解释同处一…
createdAt: 2026-10-30T02:53:02.440Z
kind: memory
memoryKind: decision
state: current
epoch: 0
promotions: []
history: []
---

宪法修订，日期 2026-10-29。

## 理由

文档只有一个主语言，每个概念只需要一个写法；领域术语改由按目录归属的 concepts.md 拥有，定义与解释同处一页，正文可以链接到定义

## 影响

C-001 第 1、2 款的术语 owner 由 concepts.json 改为 concepts.md；多语言名称与允许别名取消；运行时只识别 concepts.md，不读取、检测或迁移 concepts.json，接入项目手动改写；条文中的「契约」统一写作 Spec，C-010 第 1 款句首改为「一套工作范式」，规则含义与款 ID 不变

## 来源

- `docs/design/markdown-terminology/README.md`
