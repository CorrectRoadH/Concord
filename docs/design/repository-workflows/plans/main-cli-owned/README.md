# Issue 写入归基础 CLI，仓库贡献归高级治理

## Problem

在不让基础本地流程依赖 `concord.repository.json` 的前提下，补齐远端 Issue 写入、文档并行切分与单一 Issue 写入口，并让宿主只组合 Concord 拥有的命令树。

## Core Mental Model

- `concord issue` 是本地 Issue owner 的唯一写入口，同时提供远端 `plan`/`execute`。它已被 Web、action 与无 profile 的消费者使用。
- `concord feedback` 只负责外部来源：连接、同步、按 URL 导入、读取。`concord repo feedback` 只保留信封导入导出与只读检查。
- `concord docs work` 属于基础 `docs` 组，配置在 `concord.config.ts`，纯文档仓库也能使用。
- `concord repo` 的 Feedback、Memory、Docs 命令树由各领域贡献导出，Concord 自身的 `repo` 入口与消费者宿主组合同一份贡献。
- Trace 编译把可归因到单个测试源码文件的错误降为 finding；只读命令报告，写入和完整图裁决拒绝。

## Scope

完整契约见 [architecture](architecture.md)。不包括 API token 远端写入、Linear 写入、远端对象的本地镜像、Memory 双入口合并。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-完整图裁决不接受部分输入) | satisfied | 编译产出 `complete` 与 `findings`；依赖完整关系图的写入经过 `requireCompleteTrace` | [Trace 容错](architecture.md#trace-容错编译) |
| [L2](../../LIMITS.md#l2-远端写入只在当次明确授权后发生) | satisfied | execute 要求与 receipt 完全一致、绑定动作、目标与 payload 的 `--authorize`；只用 gh 登录态与已绑定仓库 ID 的连接；receipt 单次消费、5 分钟过期、CAS 前像；正文经 stdin 传入 | [远端写入](architecture.md#远端-issue-写入) |
| [L3](../../LIMITS.md#l3-写入遵守前像与恢复契约) | satisfied | Issue 写入沿用基础 CLI 的单文件发布 journal；Docs Work 状态在 Git-private 目录原子替换，配置与依赖收据变化时拒绝 | [Issue 生命周期](architecture.md#本地-issue-单一写入口)、[Docs Work](architecture.md#docs-work) |
| [L4](../../LIMITS.md#l4-破坏兼容的变更有迁移说明) | satisfied | 被移除的写命令返回 `CommandRetired` 并给出替代命令；前置条件取两入口并集；Issue 文件格式不变；输出契约见[公开输出契约](architecture.md#公开输出契约) | [迁移](architecture.md#退役与迁移) |
| [L5](../../LIMITS.md#l5-执行与副作用通过-effect-服务) | satisfied | Docs Work 用 Clock 与 ChildProcessSpawner；gh 使用既有受管进程 | [Docs Work](architecture.md#docs-work) |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-单文件错误不阻断只读查询) | satisfied | 测试源码错误逐文件隔离，文案给出建议引用；Markdown owner 错误仍整体失败 | C1 |
| [G2](../../GOALS.md#g2-远端-issue-写入可按契约执行) | satisfied | `concord issue plan <operation>` 与 `concord issue execute` | C2、C3 |
| [G3](../../GOALS.md#g3-本地-issue-只有一个名字和一个写入口) | satisfied | 全部本地写入在 `concord issue`；Feedback 只接入来源 | C4 |
| [G4](../../GOALS.md#g4-共享工作树上的并行文档切分) | satisfied | scoped-clean、声明式 read/blockedBy/check、配置的 finalizer | C5、C6 |
| [G5](../../GOALS.md#g5-领域拥有命令树宿主只组合) | satisfied | `feedbackCommandContribution`、`memoryCommandContribution` 与 `runComposedCli` | C7 |

## Entry Points

- [architecture](architecture.md)：命令、数据格式、错误与验收。
