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
| [L1](../../LIMITS.md#l1-只有当前格式) | satisfied | 一次性改写 | 设计推理 |
| [L2](../../LIMITS.md#l2-修复经过核验且可审计) | not-satisfied | 现行门禁在关闭前核验，但收据在 Git-private 目录，仓库中不可审计 | 现行实现 |
| [L3](../../LIMITS.md#l3-工具写入保护前像) | satisfied | 写入路径不变 | 现行实现 |
| [L4](../../LIMITS.md#l4-关系从来源派生) | satisfied | 关系保存在元数据，反向派生 | 现行实现 |
| [L5](../../LIMITS.md#l5-声明式文档只写当前) | satisfied | 删除 createdAt | 设计推理 |
| [L6](../../LIMITS.md#l6-不重复保存可推导的事实) | not-satisfied | id、kind、title、feature 仍保存 | 设计推理 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-重复声明最少) | not-satisfied | `id`、`kind`、`title` 与所属 Feature 仍与路径和标题重复 | 本仓库 164 个 owner 的 id 全部等于路径名 |
| [G2](../../GOALS.md#g2-每件事只有一个归属) | not-satisfied | Problem 与 Issue、Memory Decision 与 Design 仍重叠 | 设计推理 |
| [G3](../../GOALS.md#g3-日常维护的步骤少) | not-satisfied | 命令面不变，约 30 个 | 现行 CLI 帮助 |
| [G4](../../GOALS.md#g4-零配置可用) | partial | 删除 `constitution` 配置；`projectId`、`testRoots` 与 runner 仍必需 | 设计推理 |
| [G5](../../GOALS.md#g5-检查与保证不变弱) | satisfied | 检查与授权不变 | 现行实现 |

## Entry Points

- [Architecture](architecture.md)
