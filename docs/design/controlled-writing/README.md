---
format: concord.document/v1
id: controlled-writing
title: 受控写作规则
createdAt: 2026-10-21T07:39:50.383Z
kind: design
alternatives:
  - policy-rules
  - external-linter
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-004
  - docs/constitution.md#c-007
  - docs/constitution.md#c-009
  - docs/constitution.md#c-010
  - docs/constitution.md#c-014
---

# 受控写作规则

## Problem

写作政策需要分别表达字符长度与中英文 token 长度，并按 Markdown 结构区分程序性与描述性文本。词表约束只能观察词面，不能证明一句只有一条指令或语法正确。

[Research](../../research/ste-writing-rules/README.md) 区分外部规范事实与 Concord 的设计参数。本 Design 比较内置门禁，以及内置门禁加显式外部建议两个候选。

## Core Mental Model

- legacy 路径保留字符长度、分句与文本抽取语义；controlled 路径单独定义 token、分句及列表类型。两者可同时生效。
- controlled 中每个行内代码计 1，代码内容不参与词表匹配。legacy 长度计入代码内容字符。
- [共同身份与观察结果](../test-journey-steps/共同身份.md#步骤语法) 拥有步骤标记语法。合法步骤的末尾 `{#id}` 在两条路径中均排除，不参与长度与词表匹配。
- controlled 的列表类型来自 AST 祖先。有序列表项中的直接段落为程序性；普通段落与无序列表项为描述性。引用内统一为描述性，其它嵌套列表使用最近的列表类型。
- controlled 的语言选择与计数是可复现的启发式，允许目录显式指定语言，不声称自动识别正确。
- 政策是唯一规则来源。词法约束默认关闭，开启后的 finding 纳入现有写作门禁，并只陈述观察事实。

## Scope and Tradeoffs

范围是政策格式、抽取、合成、诊断、显式迁移与验收。Concord 使用自己的规则名和项目自有词表，不分发外部规范原文或词典，不声称获得认证或符合 ASD-STE100。

名词串、词义、词性、时态和指令数量的语义证明不在范围内。20/25/6 是可以选择的项目参数，仍为二手、待核实的外部规范数值；中文参数属于 Concord 政策。

步骤身份与观察协议直接引用共同契约。本 Design 不修改测试关联、原生选择或收据，不依赖 adapter、LSP 或其缓存。

## Entry Points

- [Goals](GOALS.md)
- [Limits](LIMITS.md)
- [Cases](CASES.md)
- [Decision](DECISION.md)
- [政策规则](plans/policy-rules/README.md)
- [内置门禁与显式外部建议](plans/external-linter/README.md)
