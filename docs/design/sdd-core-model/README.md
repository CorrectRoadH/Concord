---
format: concord.document/v1
id: sdd-core-model
title: 以 Spec 驱动开发的核心模型
createdAt: 2026-10-30T03:41:16.095Z
kind: design
alternatives:
  - convention-first
  - trimmed-current
  - derive-duplicates
---

# 以 Spec 驱动开发的核心模型

## Problem

Concord 存在的理由是让 Spec 成为软件的唯一事实来源，并为人与 coding agent 提供同一套工作方法：人审阅的是 Spec 的变化，agent 按 Spec 实现并用测试证明，Concord 检查三者是否一致（[为什么需要 Concord](../../why-concord.md)）。

现行模型能做到这些，但维护成本高，自身也难以遵守：

- 文档类别多，边界重叠。Feature、Use Case、Engineering、Roadmap、Design、Research、Memory（Problem、Decision、Insight、Note）、Issue、宪法、概念与写作政策，各有 Schema、生命周期与命令。Roadmap 与「尚无测试的 Feature」表达同一件事；Memory Problem 与 Issue 都在追踪缺陷；Memory Decision 与 Design 都在记录决策。
- 元数据重复路径。本仓库 164 个 owner 的 `id` 全部等于路径名；`kind`、Use Case 的 `feature` 与 `title` 也都能从位置和一级标题得到。重复的声明需要工具维护一致，格式每变一次就要改写全部文件与测试夹具。
- 记录类 owner 带着空的样板结构，例如 Issue 的 `memoryRelations: []`、`adoptions: {current: [], history: []}`、`history: []`，并在 frontmatter 中保存本可由 Git 提供的历史。
- 配置声明了约定就能决定的事：`constitution.path` 只能取一个值，`projectId` 与 worktree 根和 Git-private 目录重复，`documentDefaults`、`testRoots` 与 `sourceRoots` 多数项目取默认值。
- 因为元数据由工具维护，编辑 Spec 也要经过专用命令（`author set`、`page set`、各类 `create`），CLI 有约 30 个子命令组。

需要决定的是：哪些事实由位置与约定推导、哪些语义必须显式保存，以及哪些现有保证要明确放弃。三个候选分别是：按约定重建并放弃部分保证（convention-first），只删空样板（trimmed-current），约定推导重复事实、显式保存不可推导语义（derive-duplicates）。

## Core Mental Model

Spec 由 Feature 组成。一个 Feature 包含四种页面：README 说明能力，Use Case 写用户路径与验收，architecture 写实现，示例页（cli，库为 library）给出具体调用与输出。宪法、概念与写作政策是所有 Feature 共同遵守的项目规则。

文档按「回答什么问题、有什么生命周期」分类，再加上从源码派生的关联：

| 类别 | 回答 | 生命周期 |
| --- | --- | --- |
| Spec | 系统现在必须怎样 | 只有当前；直接编辑，历史在 Git |
| 项目规则 | 所有 Feature 共同遵守什么 | 只有当前；修订理由记为知识 |
| 决策记录 | 为什么这样设计 | 裁决后不改写 |
| 工作项 | 哪里不对、还要做什么 | 打开与关闭，关闭带结论与证据 |
| 知识 | 学到了什么 | 现行或被替代 |
| 关联 | 谁实现、谁验证 | 从源码标记与运行收据派生 |

比较标准见 [Goals](GOALS.md)，硬约束见 [Limits](LIMITS.md)，共同场景见 [Cases](CASES.md)。

## Scope

范围：文档分类、文件布局与身份、元数据、配置、CLI 命令面，以及围绕它们的工作方法。

不在范围：工作区服务与 CLI 热路径（见 [CLI 热路径](../cli-hot-path/README.md)）、测试执行机制、写作规则的内容。

## 宪法修订提案

选择 derive-duplicates 时按 [C-008](../../constitution.md#c-008-2) 修订：

- C-001-1：Memory 拥有正文、类型、状态与替代关系；缺陷的生命周期归 Issue。
- C-001-5：Memory 与 Issue 的正文可以直接编辑；状态、带角色的关系与关闭结论只经由 Concord 命令写入。
- C-004-2：「Issue 标记为 fixed 前，回归测试必须在明确的缺陷提交上失败、在修复提交上通过；核验结论写入 Issue，可在声明的输入与环境下重放。」
- C-010-5、C-010-6 与 C-012-6：明确放弃 Git-private 收据作为修复证明；已有收据原地保留、不再读取，不删除原件；repository profile 的可靠性证据另行决定，在决定前保持现行。
- C-012-4 不变：Roadmap 仍表示尚未采用的方向。

## Entry Points

- [Goals](GOALS.md)
- [Limits](LIMITS.md)
- [Cases](CASES.md)
- [Decision](DECISION.md)
- 候选：[convention-first](plans/convention-first/README.md)、[trimmed-current](plans/trimmed-current/README.md)、[derive-duplicates](plans/derive-duplicates/README.md)

## Constitution

- [C-001](../../constitution.md#c-001)
- [C-004](../../constitution.md#c-004)
- [C-009](../../constitution.md#c-009)
- [C-012](../../constitution.md#c-012)
