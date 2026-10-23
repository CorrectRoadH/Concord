---
format: concord.document/v1
id: contract-writing
title: 契约写法与源码关联
createdAt: 2026-10-23T03:54:29.688Z
kind: design
alternatives:
  - behavior-anchored
  - wording-only
constitutionRefs:
  - docs/constitution.md#c-011
  - docs/constitution.md#c-012
  - docs/constitution.md#c-008
decision:
  selected: behavior-anchored
  reason: 行为页与实现页的分工、关联范围的选择是接入项目必须采用的跨项目规则，写入宪法 C-011 与 C-012；独立审查三轮后批准
  at: 2026-10-23T04:17:57.141Z
  targets:
    - docs/feature/documentation-quality/README.md
---

# 契约写法与源码关联

## Problem

宪法 C-011 只规定测试关联，C-012 把五件事放在一条里：docs 只写声明、过程进入 Memory、Memory/Issue 只经工具维护、本地 Issue 不依赖外部服务、凭据不落盘。两条都没有回答这三个问题：

- 契约应该写到什么程度，读者才能不看代码就判断行为是否正确。
- 实现说明放在哪里，才不会随重构让行为页和测试标记失效。
- 代码与测试的关联要多细，才能回答“这一步由哪段代码实现、哪个测试验证”。

自举仓库显示了后果。78 个 Feature 页面中只有 1 个给出 JSON 输出；行为页大量出现 HawDB、journal、preimage 等实现词；157 条代码声明中 133 条是文件级，其中 33 个文件指向同一个 Use Case。

## Core Mental Model

从读者需要回答的问题推出规则：

| 读者的问题 | 由谁回答 | 推出的规则 |
| --- | --- | --- |
| 这个功能对使用者做什么 | 行为页：Feature README、Use Case、cli、library | 用使用者的语言写输入、可观察结果、错误与约束 |
| 怎样确认它做到了 | 行为页中的命令、机器可读输出、退出码与具名错误 | 规范性陈述可被测试断言；人读示例帮助理解，不逐字保证 |
| 它是怎么实现的 | architecture 与 lifecycle 页 | 写归属、数据流、不变量与失败阶段，随实现修改 |
| 这段代码或测试服务哪条行为 | 源码中的关联标记 | 指向能完整描述其职责的最小既有契约范围，见候选的合法目标 |
| 为什么这样做、以前出过什么问题 | Design、Memory、Issue | 不写进契约正文 |

行为比实现稳定。指向行为契约的测试关联不随内部重构失效；只保证内部不变量的测试指向 architecture 页，随实现调整。关联范围要与职责匹配：一个共享基础设施文件指向 Feature README 是合理的，但实现某一步的函数也只指向 README 时，关联回答不了哪一步由哪段代码实现。

## Scope and Tradeoffs

本 Design 只修订宪法条款与写作指南，不改变标记语法、关联身份或 JSON 字段。`@concord-file`、`@concord-code`、`@concord-begin/end` 保持现有语义。是否在 `trace gaps` 中提示粗粒度声明，由后续 Design 决定。

## 验收边界

- 修订后的宪法通过 `concord constitution amend` 采用，元数据记录理由、来源与影响。
- 引用 c-011、c-012 的 Feature 与 Design 逐一核对，确认引用仍然成立。
- 宪法不声称现有文档或代码已经符合新规则；不符合的页面与声明按新规则逐步改写。
