---
format: concord.document/v1
id: mutate-remote-issue
title: 计划并执行一次远端 Issue 写入
createdAt: 2026-10-01T04:04:37.739Z
kind: use-case
feature: docs/feature/neutral-project-governance/README.md
---

# 计划并执行一次远端 Issue 写入

## 用户目标

维护者在取得对目标仓库和具体动作的明确授权后，通过 Concord 对 GitHub Issue 执行一次可核验的写入；没有授权时只得到只读证据。

## 完整路径

1. 项目已有 `transport: 'gh'` 且记录了 `repositoryId` 的 GitHub 连接，运行 Concord 的机器已完成 `gh auth login`。
2. 运行 plan，例如 `concord issue plan close 12 --connection product-gh --reason completed --json`。Concord 只读取远端：create 完整列出 open 与 closed Issues，编号目标读取当前状态，然后输出 receiptId、前像 digest、有效期和 `authorize` 目标串，例如 `close:example/product#12@3f9a1c2b7d4e`。目标串绑定动作、目标与 payload。
3. 维护者把 plan 结果交给有权限的人确认。授权不确定时到此为止。Agent 不能因为 plan 成功或工具可用而自行传入授权串。
4. 取得当次授权后运行 `concord issue execute <receipt-id> --connection product-gh --authorize close:example/product#12@3f9a1c2b7d4e --json`。Concord 核对授权目标串、消费 receipt、重新读取远端前像并执行一次写入，返回写入后的 Issue。

## 结果

- 授权目标串不符、receipt 过期或已使用、远端在 plan 后变化、仓库 ID 不符时，具名失败且没有远端写请求。
- 目标是 Pull Request、使用 API token 连接、连接未绑定仓库 ID、目标已是计划状态、读取超出预算时，plan 失败且不签发 receipt。
- 写入结果不确定时返回 `IssueMutationUncertain`，Concord 不自动重试，必须重新 plan。已生效的 close、reopen、标签与正文写入在重新 plan 时返回 `IssueNoChange`；machine-origin create 会重新完整扫描 origin-key；manual create 与评论需要人工核对远端。
- 远端写入只通过 CLI 与宿主组合的同一贡献提供，Web 与 action 不提供。
- 本地 `docs/issues` 不因远端写入改变。

## 契约来源

- [远端 Issue 写入](../../../design/repository-workflows/plans/main-cli-owned/architecture.md#远端-issue-写入)
- [公开输出契约](../../../design/repository-workflows/plans/main-cli-owned/architecture.md#公开输出契约)
- [Feedback CLI 接入设计](../../feedback/cli-integration.md)
- [宪法 C-007](../../../constitution.md#c-007)
