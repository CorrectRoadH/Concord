# 全部归入高级治理入口

## Problem

把本地 Issue 生命周期、远端 Issue 写入、Docs Work 与命令贡献全部放进 `concord repo`，基础 `concord issue` 与 `concord feedback` 只保留读取和外部来源接入。

## Core Mental Model

`concord repo` 被视为“仓库工作流”的唯一宿主：它已经拥有 Trace 多文件 journal、Feedback 七种闭合类型和 Memory 生命周期。基础 CLI 的 Issue 写命令退役，消费者统一组合 `concord-sdlc/repository/*` 的贡献。

## Scope

- 本地 Issue 写入：`concord repo feedback` 改名 `concord repo issue`，承担 create/edit/link/adopt/retire/close/reopen/remove；基础 `concord issue` 只读。
- 远端写入：`concord repo issue plan/execute`。
- Docs Work：`concord repo docs work`。
- Trace 容错与命令贡献同 [main-cli-owned](../main-cli-owned/architecture.md)。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-完整图裁决不接受部分输入) | satisfied | 与另一候选相同的容错编译与完整性门禁 | 设计推理 |
| [L2](../../LIMITS.md#l2-远端写入只在当次明确授权后发生) | satisfied | 复用同一 plan store、CAS 与授权标志 | 设计推理 |
| [L3](../../LIMITS.md#l3-写入遵守前像与恢复契约) | satisfied | Trace 多文件 journal | 设计推理 |
| [L4](../../LIMITS.md#l4-破坏兼容的变更有迁移说明) | not-satisfied | 不使用 `concord.repository.json` 的项目失去全部本地 Issue 写入；Web 与 action 的 Issue 操作也必须迁到 profile，基础流程开始依赖高级治理配置，违背 [C-002](../../../../constitution.md#c-002) 与本地观察契约 | [本地观察契约](../../../../feature/feedback/use-case/manage-local-observations.md)要求无 provider 配置的消费者完成完整 CRUD |
| [L5](../../LIMITS.md#l5-执行与副作用通过-effect-服务) | satisfied | 同另一候选 | 设计推理 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-单文件错误不阻断只读查询) | satisfied | 同另一候选 | C1 |
| [G2](../../GOALS.md#g2-远端-issue-写入可按契约执行) | satisfied | profile 内 plan/execute | C2、C3 |
| [G3](../../GOALS.md#g3-本地-issue-只有一个名字和一个写入口) | satisfied | 基础入口只读 | C4 |
| [G4](../../GOALS.md#g4-共享工作树上的并行文档切分) | partial | Docs Work 被绑定到需要 suite 配置的入口，纯文档仓库无法使用 | C5 |
| [G5](../../GOALS.md#g5-领域拥有命令树宿主只组合) | satisfied | 同另一候选 | C7 |
