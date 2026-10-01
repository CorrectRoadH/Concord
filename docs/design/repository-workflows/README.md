---
format: concord.document/v1
id: repository-workflows
title: 仓库工作流贡献的归属与远端 Issue 写入
createdAt: 2026-10-01T03:54:52.005Z
kind: design
alternatives:
  - profile-owned
  - main-cli-owned
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-003
  - docs/constitution.md#c-007
  - docs/constitution.md#c-012
  - docs/constitution.md#c-013
  - docs/constitution.md#c-015
decision:
  selected: main-cli-owned
  reason: 本地 Issue 写入留在基础 concord issue 以满足无 profile 的本地 CRUD；远端写入以绑定 payload 的授权串、CAS 与固定 gh 写请求执行一次；Trace 只读查询隔离单文件测试源码错误，完整图裁决仍拒绝不完整输入；Docs Work 采用 scoped-clean 与配置声明的检查。独立审查 8 项阻断已修订。
  at: 2026-10-01T07:58:45.990Z
  targets:
    - docs/feature/neutral-project-governance/README.md
    - docs/feature/feedback/README.md
---

# 仓库工作流贡献的归属与远端 Issue 写入

## Problem

接入项目在共享工作树上并行运行多个 Agent，并通过宿主 CLI 组合 Concord 的仓库治理能力。当前存在五个缺口：

1. 一个测试源码文件的标记格式错误会让所有依赖 Trace 的只读查询整体失败，错误文案也没有说明真实约束。
2. 远端 Issue 写入的领域实现（plan receipt、CAS、单次消费）已存在，但没有受管入口，契约要求的 plan-then-execute 无法执行。
3. 文档并行切分（Docs Work）是中立能力，却只在消费者本地实现，并要求整仓干净，无法在共享 main 上使用。
4. 同一批 `docs/issues/*.md` 有两个写入口：`concord issue` 与 `concord repo feedback`，闭合模型和命名都不同。
5. Feedback / Memory 的命令树由宿主手写；宿主组合的未知子命令只打印根 help。

需要比较的是：本地 Issue 的唯一写入口、远端写入入口和仓库工作流命令树分别归属于基础 CLI 还是高级治理入口 `concord repo`。

## Core Mental Model

- **Issue** 是 `docs/issues/<id>.md` 中 `kind: issue` 的本地 owner，只有一个写入口。**Feedback** 是外部来源的接入面（连接、同步、导入、信封），只创建来源记录，不维护 Issue 生命周期。
- **远端 Issue 写入**是对外操作。plan 只读收集证据并签发短时、单次使用的 receipt；execute 只在调用方显式声明当次授权后，以 CAS 核对远端前像并执行一次写入。receipt 不携带也不推断授权。
- **命令贡献**（contribution）由领域拥有 verbs、options、`--help` 与终端交付；宿主只按顺序组合。
- **容错只读查询**把可隔离到单个测试源码文件的格式错误记为带路径的 finding，传播 `complete: false`，继续返回其余结果。需要完整图的裁决和写入仍拒绝不完整输入（[C-013](../../constitution.md#c-013)）。
- **Docs Work** 的 run 是 Git-private 的协作收据，不是计划或第二份索引。检查命令与 finalizer 命令由项目配置声明，run 输入只能引用其 ID。

## Scope and Tradeoffs

范围包括：Trace 容错与文案、`issue plan/execute`、Docs Work、Issue 单一写入口、Feedback/Memory 命令贡献、组合 CLI 的未知子命令错误，以及 Trace 发布协议文档的归属。

不包括：远端 Issue 写入使用 API token 传输、Linear 写入、远端评论/标签的本地镜像、Memory 双入口的合并、自动启动或调度 Agent。

取舍：退役 `concord repo feedback` 与 `concord feedback` 的本地写命令会破坏现有消费者调用（[C-007](../../constitution.md#c-007)），需要独立设计挑战并给出迁移步骤。远端写入引入新的对外信任边界，只复用已有的 gh 登录态和项目声明的连接范围。

## Entry Points

- [Goals](GOALS.md): requirements and comparison criteria.
- [Limits](LIMITS.md): constraints shared by every candidate.
- [Cases](CASES.md): neutral scenarios for the comparison.
- [Decision](DECISION.md): explanatory evidence.
- [profile-owned](plans/profile-owned/README.md)：全部归入 `concord repo`。
- [main-cli-owned](plans/main-cli-owned/README.md)：Issue 写入归基础 CLI，仓库工作流贡献归 `concord repo`。

Each candidate in plans/ is a self-contained feature design package.
The decision is recorded only by `concord design decide`; writing prose does not select a candidate.
