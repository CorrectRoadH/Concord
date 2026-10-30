# trimmed-current

## Problem

保留现行分类与命令，只删掉样板：空的数组与对象可以省略，`format` 与 `createdAt` 从 frontmatter 删除，配置中只能取一个值的项（`constitution.path`）删除。其余元数据（`id`、`kind`、`title`、Use Case 的 `feature`、Issue 与 Memory 的关系与历史）与各类别的生命周期命令不变。

## Core Mental Model

- 类别不变：Feature、Use Case、Engineering、Roadmap、Design、Research、Memory（Problem、Decision、Insight、Note）、Issue。
- 元数据仍由工具维护，编辑 Spec 仍经过 `author set` 与各类 `page` 命令。
- 改动集中在 Schema 的默认值与少数配置项，消费者改写量小。

详细机制见 [Architecture](architecture.md)。

## Scope

包含：Schema 的可选字段与默认值、删除 `format`、`createdAt` 与 `constitution` 配置。

不包含：类别合并、命令面调整、零配置。

接受的取舍：重复声明与重叠类别保留；改名仍需同步元数据；CLI 命令面不变。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-只有当前格式) | satisfied | 一次性改写，删除的字段不再读取 | 设计推理 |
| [L2](../../LIMITS.md#l2-修复可以复现) | satisfied | Problem 的证据门禁不变 | 现行实现 |
| [L3](../../LIMITS.md#l3-工具写入保护前像) | satisfied | 写入路径不变 | 现行实现 |
| [L4](../../LIMITS.md#l4-关系从来源派生) | satisfied | 关系仍保存在元数据中，反向关系派生 | 现行实现 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-每个事实只声明一次) | not-satisfied | `id`、`kind`、`title` 与所属 Feature 仍与路径和标题重复 | 本仓库 164 个 owner 的 id 全部等于路径名 |
| [G2](../../GOALS.md#g2-分类少而不重叠) | not-satisfied | Roadmap 与未测 Feature、Problem 与 Issue、Memory Decision 与 Design 仍重叠 | 设计推理 |
| [G3](../../GOALS.md#g3-编辑-spec-不需要专用命令) | not-satisfied | 元数据仍需工具维护；约 30 个子命令组 | 现行 CLI 帮助 |
| [G4](../../GOALS.md#g4-零配置可用) | partial | 删除 `constitution` 配置；`projectId`、`testRoots` 与 runner 仍必需 | 设计推理 |
| [G5](../../GOALS.md#g5-检查不变弱) | satisfied | 检查不变 | 现行实现 |

## Entry Points

- [Architecture](architecture.md)
