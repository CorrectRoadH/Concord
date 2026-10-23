---
format: concord.document/v1
id: constitution-structure
title: 宪法的结构、关联与写法
createdAt: 2026-10-23T04:26:33.083Z
kind: design
alternatives:
  - link-owned
  - metadata-owned
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-003
  - docs/constitution.md#c-007
  - docs/constitution.md#c-008
  - docs/constitution.md#c-009
  - docs/constitution.md#c-015
---

# 宪法的结构、关联与写法

## Problem

宪法是 Concord 要求每个接入项目采用的范式，但它自己的结构、关联与写法都有缺口：

| 方面 | 现状 | 后果 |
| --- | --- | --- |
| 条款身份 | 单独一行 HTML `<a id="c-003"></a>` | 全仓库只有宪法用 HTML anchor，其它位置使用标题 `{#id}` 或步骤 `{#id}`，宪法需要专用解析 |
| 款的身份 | 只有序号 | 正文用“C-011 第 3 款”引用，共 36 处；重新编号后只能人工查找 |
| 依据关系 | Feature 与 Design 的 `constitutionRefs` 元数据，共 36 个 owner、248 条 | 只能表达到 owner；另有 27 个文件、100 处正文链接，其中 22 个是附页，`check` 不校验，指向不存在的 `#c-099` 仍然通过 |
| 写法 | 总则只定义用语强度 | C-001.4、C-005.3 至 .4、C-013 写入引擎、桥接与协议细节，随实现变化 |

## Core Mental Model

读者面对一条规则时要回答三个问题：

| 读者的问题 | 由谁回答 | 推出的规则 |
| --- | --- | --- |
| 这条规则要求什么 | 宪法中的一款 | 每款一项可审阅的义务，带稳定 ID |
| 哪些地方依据它 | 依据它的那句话旁的链接 | 链接拥有依据关系，反向关系派生 |
| 引用是否仍然成立 | `concord check` | 每个指向宪法的链接都校验目标 |

宪法只写规则。理由、来源与影响写在修订记录，机制与实现写在 architecture 页。

## Scope and Tradeoffs

本 Design 决定宪法的 ID 语法、依据关系的 owner、引用校验、写作规则、迁移方式与自举顺序。标记语法、测试与代码关联不变。

候选比较依据关系由谁拥有。两案使用同一套 ID 语法与写作规则。

## 自举

这次修改本身按 Concord 的流程完成。收据要求 red 与 green 由同一份 Concord 实现签发，所以签发工具与被测候选分开：

| 角色 | 位置 | 说明 |
| --- | --- | --- |
| 签发工具 | `/tmp/concord-signer`：开工前把当前 HEAD `pnpm pack` 后安装到这里 | 只用于 `test run` 与 `memory resolve`；全程不更新 |
| 被测候选 | 本仓库 `src/` 与重新构建的 `dist/` | 回归测试在隔离消费者中运行构建后的 CLI，runner 用 tsx 运行测试文件 |
| 仓库格式 | 本仓库 `docs/` | Problem 关闭前保持 v1，签发工具可以读取 |

执行顺序：

1. Design 经独立审查后定案。
2. 修改 `project-onboarding` 的 Use Case 与 CLI 契约，写出新输出与错误（预期输出）。
3. Problem `constitution-body-links-unchecked` 已记录。回归测试用 `@regression` 指向它，在临时消费者中写入断开的宪法链接并断言 `check` 退出 1。用签发工具运行 `test run`，取得 red。
4. 实现并重新构建 `dist/`。测试定义与契约不变，用签发工具再次 `test run` 取得 green，然后 `memory resolve --kind fixed`。仓库仍是 v1，签发工具可以完成全部核验。
5. 用新构建的 CLI 运行 `concord --dry-run constitution migrate`，再执行迁移。迁移之后签发工具无法读取本仓库，已关闭的 Problem 不受影响。
6. 按条款写法改写宪法，把 36 处“第 N 款”文字逐处核对当前语义后改为链接，通过 `constitution amend` 采用。
7. `concord check` 通过；迁移验收按 link-owned 的“迁移验收”判定。

## 验收边界

- 迁移不丢失任何依据关系，修订历史原样保留。
- 宪法不声称现有 owner 已经符合新写法。
