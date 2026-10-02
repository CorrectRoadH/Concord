---
format: concord.document/v1
id: plan-content
title: Plan 文件与目录
createdAt: 2026-10-02T01:00:00.000Z
kind: design
alternatives:
  - derived-entry
  - directory-only
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-003
  - docs/constitution.md#c-007
  - docs/constitution.md#c-010
  - docs/constitution.md#c-013
  - docs/constitution.md#c-014
  - docs/constitution.md#c-015
decision:
  selected: derived-entry
  reason: 候选名保持唯一身份，文件或目录入口精确派生；当前检查仅在来源漂移时有界重试
  at: 2026-10-02T01:10:36.225Z
  targets:
    - docs/feature/document-packages/README.md
---

# Plan 文件与目录

## Problem

小方案适合一个 Markdown 文件，大方案需要按主题分目录。候选身份与正文存储形式必须分开，CLI、关系图、repository 定案和工作台必须解析同一个入口。

## Candidates

- [派生入口](plans/derived-entry/README.md)：同一个候选选择单文件或目录形式。
- [固定目录](plans/directory-only/README.md)：所有候选保持目录，只扩展内部页面。

## Contract

具体结构、边界与验收见[方案契约](architecture.md)。本 Design 未定案时，该契约是待审候选。
