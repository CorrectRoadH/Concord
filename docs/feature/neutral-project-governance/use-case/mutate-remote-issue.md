# 计划并执行一次远端 Issue 写入

## 用户目标

维护者在取得对目标仓库和具体动作的明确授权后，通过 Concord 对 GitHub Issue 执行一次可核验的写入；没有授权时只得到只读证据。

## 起始状态

- 项目已有 `transport: 'gh'` 且记录了 `repositoryId` 的 GitHub 连接 `product-gh`，指向 `example/product`。
- 运行 Concord 的机器已完成 `gh auth login`。
- 命令、字段与错误码见 [CLI](../cli.md#远端-issue-写入)。

## 完整路径

1. 计划要做的写入。 {#preview}

   ```sh
   concord issue remote preview close 12 --connection product-gh --reason completed --json
   ```

   以下为预期输出：

   ```json
   {"operation":"issue-plan","receiptId":"8d0f3c52-1a7e-4b9d-9c11-2f6e5a0b7c34","connection":"product-gh","issueOperation":"close","target":"example/product#12","payloadDigest":"sha256:3f9a1c2b7d4e…","remotePreimageDigest":"sha256:…","expiresAt":"2026-11-05T08:05:00.000Z","authorize":"close:example/product#12@3f9a1c2b7d4e"}
   ```

   preview 只读取远端，不写 docs，也不发写请求。远端写入计划 5 分钟内有效，只能用一次。

2. 把计划交给有权限的人确认。 {#authorize}

   `authorize` 是要确认的授权串，绑定动作、目标与 payload。`--authorize` 是调用方声明的当次授权，不是凭据；Concord 不保存授权记录，也不证明授权真实存在。Agent 只有在用户就该授权串或其中的动作、目标与 payload 明确同意后才能传入，不得因 preview 成功、工具可用或权限宽松而推断授权（[协作与授权](../../../engineering/self-hosting/README.md#协作与授权)）。授权不确定时到此为止。

3. 取得当次授权后执行。 {#apply}

   ```sh
   concord issue remote apply 8d0f3c52-1a7e-4b9d-9c11-2f6e5a0b7c34 --connection product-gh --authorize close:example/product#12@3f9a1c2b7d4e --json
   ```

   以下为预期输出：

   ```json
   {"operation":"issue-execute","receiptId":"8d0f3c52-1a7e-4b9d-9c11-2f6e5a0b7c34","issueOperation":"close","issue":{"number":12,"url":"https://github.com/example/product/issues/12","state":"closed","title":"Checkout total is wrong","labels":["bug"]}}
   ```

   apply 重新读取远端前像，恰好发出一次写请求，正文经 stdin 传给 gh。本地 `docs/issues` 不变。

4. 结果不确定时重新计划，不重试 apply。 {#uncertain}

   写请求超时、被信号中断或响应无法解析时返回 `IssueMutationUncertain`，远端写入计划已消费。重新运行第 1 步：close 已生效时返回 `IssueNoChange`。

## 结果

| 情形 | 结果 |
| --- | --- |
| preview 成功 | 没有写请求 |
| 目标状态已等于计划结果，例如 Issue 已关闭 | `IssueNoChange`，不签发远端写入计划 |
| 连接没有记录 `repositoryId` | `IssueConnectionUnbound` |
| 仓库 ID 与连接不符，例如仓库改名或转移 | `ConnectionIdentityMismatch` |
| 目标是 Pull Request | `IssueTargetIsPullRequest` |
| 每个 preview 拒绝条件 | 具名失败，不签发远端写入计划，见 [preview](../cli.md#preview) |
| `--authorize` 或 `--connection` 与远端写入计划不符 | `IssueAuthorizationMismatch`，不消费远端写入计划，零远端调用 |
| 远端写入计划过期或已用过 | `IssuePlanExpired` 或 `IssuePlanConsumed`，零写请求 |
| 远端在 preview 后变化 | `IssuePlanDrifted`，零写请求 |
| 远端拒绝写请求 | `IssueRemoteRejected`，`details.status` 是 HTTP 状态 |
| 写请求超时 | `IssueMutationUncertain`；重新 preview close 返回 `IssueNoChange` |
| 不确定后的 manual create 或 comment-add | 没有幂等键，错误消息要求人工核对远端后再计划 |
| 超出 gh 输出、分页或时间预算 | `IssueRemoteBudgetExceeded` 或 `GhTimeout`，见[预算](../cli.md#预算) |

### 验收方式

用只模拟外部边界的 fake gh 可执行文件记录请求，在打包后公开 CLI 与隔离 Git 消费者中验证：

- preview 没有写请求；每个 preview 拒绝条件具名失败且不签发远端写入计划。
- apply 的每个拒绝条件都零写请求；带一致授权串的 apply 恰好一次写请求，正文经 stdin 传入。
- 写请求超时返回 `IssueMutationUncertain`，重新 preview close 返回 `IssueNoChange`。
