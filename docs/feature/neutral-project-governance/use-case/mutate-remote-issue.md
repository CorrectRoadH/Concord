---
format: concord.document/v1
id: mutate-remote-issue
title: 计划并执行一次远端 Issue 写入
kind: use-case
feature: docs/feature/neutral-project-governance/README.md
---

# 计划并执行一次远端 Issue 写入

## 用户目标

维护者在取得对目标仓库和具体动作的明确授权后，通过 Concord 对 GitHub Issue 执行一次可核验的写入；没有授权时只得到只读证据。

## 完整路径

1. 项目已有 `transport: 'gh'` 且记录了 `repositoryId` 的 GitHub 连接，运行 Concord 的机器已完成 `gh auth login`。
2. 运行 `concord issue plan close 12 --connection product-gh --reason completed --json`，得到 receipt 与 `authorize` 目标串，例如 `close:example/product#12@3f9a1c2b7d4e`。
3. 维护者把 plan 结果交给有权限的人确认。授权不确定时到此为止。
4. 取得当次授权后运行 `concord issue execute <receipt-id> --connection product-gh --authorize close:example/product#12@3f9a1c2b7d4e --json`，得到写入后的 Issue。

## 命令

```text
concord issue plan create   --connection <id> --title <text> --body <file|-> [--origin-key <key>]
concord issue plan body-set <number> --connection <id> --body <file|->
concord issue plan comment-add <number> --connection <id> --body <file|->
concord issue plan labels-add <number> --connection <id> --label <name>...
concord issue plan labels-remove <number> --connection <id> --label <name>
concord issue plan close <number> --connection <id> [--reason completed|not_planned]
concord issue plan reopen <number> --connection <id>
concord issue execute <receipt-id> --connection <id> --authorize <target>
```

只支持 github.com 的 `transport: 'gh'` 连接，凭据只来自 gh 登录态（[C-007](../../../constitution.md#c-007-4)）。远端写入只由 CLI 与宿主组合的同一命令贡献提供，Web 与 action 不提供；本地 `docs/issues` 不因远端写入改变。

## plan

- 只读取远端，不写 docs。连接未记录 `repositoryId` 返回 `IssueConnectionUnbound`；plan 与 execute 先读取仓库并核对仓库 ID，不符返回 `ConnectionIdentityMismatch`，改名或转移后的旧名称不会把写入导向另一个仓库。
- 目标状态已等于计划结果时返回 `IssueNoChange`，不签发 receipt：close 已关闭、reopen 已打开、labels-add 的标签全已存在、labels-remove 的标签不存在、body-set 正文相同。目标是 Pull Request 返回 `IssueTargetIsPullRequest`。
- create 完整分页列出 open 与 closed Issues 并排除 Pull Request。带 `--origin-key` 的 machine-origin create 要求正文含 `payload-sha256:` 标记，前像是带同一 origin-key 的 Issue 集合，已存在时返回 `IssueCreateConflict`；manual create 的前像是标题完全相同的 Issue 集合。其它 Issue 的变化不构成漂移。
- labels-remove 每个 receipt 只移除一个标签，重复 `--label` 返回 `InvalidInput`。标签名含控制字符或超过 50 个字符时拒绝。
- receipt 有效期 5 分钟，只能消费一次。`authorize` 绑定动作、目标与 payload：编号目标为 `<operation>:<owner>/<repo>#<number>@<payload>`，create 为 `create:<owner>/<repo>@<payload>`。`<payload>` 是 `payloadDigest` 十六进制部分的前 12 位；同一目标重新计划不同正文或标签后，旧授权串不再匹配。

## 授权

`--authorize` 是调用方声明的当次授权，不是凭据，Concord 不保存授权记录，也不证明授权真实存在。Agent 只有在用户就该授权串或其中的动作、目标与 payload 明确同意后才能传入，不得因 plan 成功、工具可用或权限宽松而推断授权（[C-007](../../../constitution.md#c-007-2)）。

## execute

1. 读取并严格解码 receipt。`--connection` 必须是签发 receipt 的同一连接，`--authorize` 与 receipt 目标完全相等；不等返回 `IssueAuthorizationMismatch`，不消费 receipt，零远端调用。
2. 原子消费 receipt：过期返回 `IssuePlanExpired`，已消费返回 `IssuePlanConsumed`。
3. 重新读取远端前像，不符返回 `IssuePlanDrifted`，零写请求。
4. 恰好执行一次写请求。确定的 4xx 或 5xx 返回 `IssueRemoteRejected`（`details.status`）。结果不确定（超时、信号、无法解析响应）返回 `IssueMutationUncertain`，`details` 含 receiptId、issueOperation、target 与请求的 method 和 path。两者都保持 receipt 已消费，不自动重试。

不确定之后必须重新 plan：已生效的 close、reopen、标签与正文写入返回 `IssueNoChange`；machine-origin create 重新完整扫描 origin-key，已生效时返回 `IssueCreateConflict`。manual create 与 comment-add 没有幂等键，错误消息要求人工核对远端后再计划。

单次 gh 输出不超过 2 MiB；一次 plan 或 execute 的列表最多 200 页（每页 100 条）、累计 64 MiB，整个命令截止 120 秒。超出返回 `IssueRemoteBudgetExceeded` 或 `GhTimeout`，不签发 receipt，execute 不发出写请求。该预算不改变 Feedback 读取的预算。

## 输出与错误

| 输出 | `--json` 字段 |
| --- | --- |
| `issue plan` | `operation: "issue-plan"`、`receiptId`、`connection`、`issueOperation`、`target`、`payloadDigest`、`remotePreimageDigest`、`expiresAt`（ISO 8601 UTC）、`authorize` |
| `issue execute` | `operation: "issue-execute"`、`receiptId`、`issueOperation`、`issue`（`number`、`url`、`state`、`title`、`labels`） |

失败输出 `{ ok: false, error, message, details? }` 并退出 1。除上文错误码外，API token 连接返回 `IssueRemoteTransportUnsupported`，receipt 不存在或损坏返回 `IssuePlanNotPlanned` 或 `IssuePlanCorrupt`，gh 失败沿用 Feedback 读取的 `Gh*` 错误。

## 验收

用只模拟外部边界的 fake gh 可执行文件记录请求，在打包后公开 CLI 与隔离 Git 消费者中验证：

- plan 没有写请求；上文每个 execute 拒绝条件都零写请求；带一致授权串的 execute 恰好一次写请求，正文经 stdin 传入。
- 每个 plan 拒绝条件具名失败且不签发 receipt。
- 写请求超时返回 `IssueMutationUncertain`，重新 plan close 返回 `IssueNoChange`。

内部 receipt store、outcome 与写请求边界见[架构](../architecture.md#远端-issue-写入)。

## Spec 来源

- [Feedback CLI 接入设计](../../feedback/cli-integration.md)
- [宪法 C-007](../../../constitution.md#c-007)
- [决策依据](../../../design/repository-workflows/DECISION.md)
