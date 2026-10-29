---
format: concord.document/v1
id: markdown-terminology
title: 单一写法的术语由 Markdown 拥有
createdAt: 2026-10-29T03:30:00.000Z
kind: design
alternatives:
  - markdown-owned
  - json-single-term
decision:
  selected: markdown-owned
  reason: 每个概念只有一个写法；定义与解释同在一页，正文链接到定义并由 check 校验；作用域、导入与发布恢复沿用目录归属方案
  at: 2026-10-29T03:30:00.000Z
  targets:
    - docs/feature/documentation-quality/README.md
---

# 单一写法的术语由 Markdown 拥有

## Problem

[目录归属方案](../scoped-terminology/plans/directory-owned/README.md)让术语按目录生效，但名称模型按语言分组：每个概念有多种语言的首选名、允许别名和弃用名。本仓库的实际情况如下：

| 方面 | 实际情况 | 后果 |
| --- | --- | --- |
| 名称 | 12 个概念全部同时写 zh 与 en 首选名，别名与弃用名均为 0 | 作者每次在两个首选名之间选择；`issue` 在正文中同时写作`观察`、`反馈`、`Issue`，`memory` 写作`工程记忆`、`工程 Memory`、`Memory` |
| 定义与解释 | 定义在 `concepts.json`，解释在 `terminology.md` 或 `concepts.md` | 解释页复述「本目录定义 Provider、Connection、Index 与 Recall」，两处需要同步 |
| 正文链接 | 正文无法链接到一条定义 | 读者从正文找不到术语定义，删除定义后正文不报错 |
| 编写 | JSON 定义不能含链接，长文本需要转义 | 定义只能写成短句，关系说明被迫放进另一个文件 |

文档只有一个主语言。正文需要的是每个概念唯一的写法，弃用写法由检查指出。

本设计只改变术语来源的格式与名称模型。作用域、继承、导入、歧义诊断、写作政策合成以及发布恢复沿用目录归属方案，不重复定义。

## Constitution

- [C-001](../../constitution.md#c-001)
- [C-003](../../constitution.md#c-003)
- [C-008](../../constitution.md#c-008)
- [C-009](../../constitution.md#c-009)
