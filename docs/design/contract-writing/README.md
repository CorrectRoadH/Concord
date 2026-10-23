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
| 怎样确认它做到了 | 行为页中的具体命令、输出、退出码与错误 | 每条行为陈述都能被一个测试断言 |
| 它是怎么实现的 | architecture 与 lifecycle 页 | 写归属、数据流、不变量与失败阶段，随实现修改 |
| 这段代码或测试服务哪条行为 | 源码中的关联标记 | 标记指向它实现或验证的最窄行为 anchor |
| 为什么这样做、以前出过什么问题 | Design、Memory、Issue | 不写进契约正文 |

行为比实现稳定。测试标记指向行为，重构只改 architecture 页，测试关联不随之失效。关联只有在两端都足够窄时才有信息量：一个文件指向一份 Feature README，只说明了目录结构已经说明的事。

## Scope and Tradeoffs

本 Design 只修订宪法条款与写作指南，不改变标记语法、关联身份或 JSON 字段。`@concord-file`、`@concord-code`、`@concord-begin/end` 保持现有语义。是否在 `trace gaps` 中提示粗粒度声明，由后续 Design 决定。

## 验收边界

- 修订后的宪法通过 `concord constitution amend` 采用，元数据记录理由、来源与影响。
- 引用 c-011、c-012 的 Feature 与 Design 逐一核对，确认引用仍然成立。
- 宪法不声称现有文档或代码已经符合新规则；不符合的页面与声明按新规则逐步改写。
