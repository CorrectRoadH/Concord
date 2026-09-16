---
format: concord.document/v1
id: spec-kit-constitution
title: Spec Kit 宪法与功能计划流程
createdAt: 2026-09-14T13:55:59.202Z
kind: research
observedAt: 2026-09-14
sources:
  - https://github.com/github/spec-kit/blob/main/templates/constitution-template.md
  - https://github.com/github/spec-kit/blob/main/templates/commands/constitution.md
  - https://github.com/github/spec-kit/blob/main/templates/plan-template.md
---

# Spec Kit 宪法与功能计划流程

## 调研结论

2026-09-14 读取上列官方 main 源码。宪法模板包含项目原则、约束、工作流及治理，并记录版本、采用与修订日期。模板示例不是 Concord 项目的既定规则。

当前 constitution 命令根据模板和现有内容修订宪法，区分破坏性修改、新增原则与措辞修正的版本增量，报告变动及待办。依赖流程运行时读取宪法；当前源码明确不修改版本化模板层。

计划模板设有 Constitution Check，要求研究前及设计后检查。Concord 可借鉴这一过程，将适用条款和修订影响带入功能规划与审阅，但不能将文本检查宣称为实现自动合规。

## Concord 的候选应用

宪法位于 docs/constitution.md 且必需，DESIGN.md 可选。功能发现的通用规则经过明确修订进入宪法，功能专属细节保留在 Feature。来源与影响可追溯；当前正文只维护一份。

参见 [需求 Feature](../../feature/project-onboarding/README.md) 和 [待裁决 Design](../../design/onboarding-contracts/README.md)。本调研不构成已采用的存储或安全契约。
