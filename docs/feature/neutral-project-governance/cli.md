# 统一项目治理命令

本页声明 `concord docs work` 与 `concord issue remote` 的调用、配置、机器可读输出与具名错误。使用路径见[并行切分文档工作](use-case/coordinate-docs-work.md)与[计划并执行一次远端 Issue 写入](use-case/mutate-remote-issue.md)。失败输出 `{ ok: false, error, message, details? }` 并退出 1。

## Docs Work

### 命令

```text
concord docs work prepare (--scope <path>... | --plan <file|->) [--base <commit>] [--run-id <id>]
concord docs work show <run-id>
concord docs work check <run-id> <item-id> --report
concord docs work check <run-id> <item-id> --verify <reported-receipt-digest>
concord docs work finalize <run-id>
```

### Docs Work 配置

项目可在 `concord.config.ts` 的 `docsWork` 中声明检查命令、finalizer 与共享路径：

```ts
docsWork?: {
  checks?: Record<string, { argv: readonly string[]; timeoutMs?: number }>;
  finalizer?: { argv: readonly string[]; timeoutMs?: number };
  sharedPaths?: readonly string[];
}
```

- argv 不经过 shell，cwd 为仓库根；恰为 `{paths}` 的元素展开为对应 item 当前 write 集合的文件列表。展开后超过 128 KiB 返回 `DocsWorkArgvTooLong`，不截断路径。`timeoutMs` 默认 600000；退出码 0 为 passed，其它退出码、超时或信号为 failed。
- 省略时内建检查 `writing` 对 write 路径运行 `concord docs check` 默认规则，内建 finalizer 运行 `concord check`。
- `sharedPaths` 默认为 `docs/README.md` 及存在的 `docs/concepts.md`、`docs/writing.md`；项目配置文件始终是共享路径。
- prepare 记录配置文件与 `docsWork` 解析结果的 `configDigest`；之后 check、verify 与 finalize 发现不一致时返回 `DocsWorkConfigChanged`，不运行检查。item 不能通过修改配置替换自己的检查。

### 计划

```ts
interface DocsWorkPlanV1 {
  format: "concord.docs-work-plan/v1";
  items: readonly {
    id: string;                 // [A-Za-z0-9][A-Za-z0-9_-]{0,127}，run 内唯一
    goal: string;
    write: readonly string[];   // 文件、目录（以 / 结尾）或 glob
    read?: readonly string[];   // 默认 []
    blockedBy?: readonly string[];
    checks?: readonly string[]; // 默认 ["writing"]
  }[];
}
```

- 每个 `--scope <path>` 生成一个 item：write 为该路径，ID 取路径末段，goal 为 `Update <path>`；末段相同返回 `DuplicateItemId`。`--run-id` 匹配 `[A-Za-z0-9][A-Za-z0-9_-]{0,63}` 且 run 不存在，否则返回 `DocsWorkRunExists` 或 `DocsWorkPlanInvalid`。省略 `--base` 时 base 为 HEAD。
- 路径是 canonical 仓库相对路径，拒绝绝对路径、`..`、symlink 组件与越出仓库的 realpath；glob 支持段内 `*` 与跨段 `**`，在 base 的 tracked 文件与 nonignored untracked 文件中匹配。
- write 是 item 拥有的范围：文件可以尚不存在；目录与 glob 在每次 check 时重新匹配，新建与删除的文件都计入。目录与 glob 匹配不超过 10000 个；read 条目须匹配 1 到 10000 个。
- 两个条目的字面前缀（第一个含通配符的段之前）互为祖先即视为重叠，即使展开结果暂不相交。
- prepare 只要求声明的 read、write 与共享路径干净。

### 规划校验

prepare 聚合全部问题，返回 `DocsWorkPlanInvalid`（`details.problems: { code, item?, path?, message }[]`），零写入：

| code | 条件 |
| --- | --- |
| `EmptyWrite`、`EmptyRead`、`UnknownCheck`、`DuplicateItemId`、`UnsafePath`、`GlobLimit`、`BaseNotAncestor` | 输入无效；`--base` 不是 HEAD 的祖先 |
| `WriteOverlap`、`SharedPathWrite`、`DirtyPath` | write 重叠或命中共享路径；read、write 或共享路径中有已暂存、未暂存或未跟踪的改动，逐条列出路径与 item |
| `UndeclaredDependency`、`UnknownDependency`、`DependencyCycle` | A 的 write 命中 B 的 read 而 B 未直接或传递 blockedBy A；依赖未知或成环 |

### 检查、核验与收尾

- check 先核对 read：排除本 item 及其直接或传递 blockedBy item 的 write 后，read 与共享路径的 digest 必须等于 prepare 时的值，否则返回 `DocsWorkReadChanged`（列出路径），不写收据。然后依次运行检查，写入 reported 收据；检查失败时收据标记 failed 并退出 1。
- `--verify` 要求当前 reported 收据 digest 等于参数、writeDigest 未变且全部检查 passed，否则返回 `DocsWorkReceiptMismatch`。每个 blockedBy item 已有 verified 收据，否则返回 `DocsWorkDependencyUnverified`。随后重新运行同一检查，全部通过才写 verified 并记录依赖的 verified 收据 digest。reported 是 Agent 的自报，verified 不信任其中的结果。
- finalize 要求 configDigest 未变，每个 item 的 verified 收据、writeDigest 与 read 核对仍有效，且记录的依赖等于对应 item 当前 verified 收据；否则返回 `blocked` 并按 item 列出原因，不运行 finalizer，退出 1。finalizer 可以写共享路径，结果为 `finalized` 或 `failed`（退出 1）；已 finalized 后再次运行返回 `DocsWorkFinalized`。同一 run 的写操作被占用时返回 `DocsWorkBusy`。

### 收据

```ts
interface DocsWorkReceiptV1 {
  format: "concord.docs-work-receipt/v1";
  runId: string; itemId: string; baseCommit: string; checkedAt: string;
  configDigest: string; readDigest: string; writeDigest: string; changedPaths: readonly string[];
  status: "reported" | "verified";
  reportedReceipt?: string;
  dependencies?: readonly { itemId: string; verifiedReceipt: string }[];
  checks: readonly { id: string; status: "passed" | "failed"; exitCode: number | null; outputDigest: string; summary: string }[];
}
```

changedPaths 是 write 集合内相对 baseCommit 有变化的路径；summary 取输出末尾不超过 4 KiB；收据 digest 是其规范 JSON 的 sha256。

### 输出

| 输出 | `--json` 字段 |
| --- | --- |
| `prepare`、`show` | `operation`、`runId`、`baseCommit`、`configDigest`、`items`（`id`、`goal`、`write`、`read`、`blockedBy`、`checks`）、`statePath` |
| `check` | `operation: "docs-work-check"`、`receipt`、`receiptDigest` |
| `finalize` | `operation: "docs-work-finalize"`、`status`（`finalized`、`failed`、`blocked`）、`blocked?`（`{ itemId, reason }[]`）、`finalizer?`（`exitCode`、`outputDigest`、`summary`） |

### 证明范围

verified 只说明声明范围内的内容通过了声明的检查（[证据的范围](../local-sdlc/README.md#证据的范围)）：写入其它 item 的 write 会在那个 item 的 verify 或 finalize 时被拒绝，任何 item 都未声明的路径上的改动不被报告，由父 Agent 的 diff 验收负责。Docs Work 不启动、等待或关闭 Agent，不合并 diff，不修改 docs。run 状态只属于当前 worktree，不进入 Git，不自动删除；`show` 列出其位置。状态文件与互斥见[架构](architecture.md#docs-work)。

## 远端 Issue 写入

### 命令

```text
concord issue remote preview create   --connection <id> --title <text> --body <file|-> [--origin-key <key>]
concord issue remote preview body-set <number> --connection <id> --body <file|->
concord issue remote preview comment-add <number> --connection <id> --body <file|->
concord issue remote preview labels-add <number> --connection <id> --label <name>...
concord issue remote preview labels-remove <number> --connection <id> --label <name>
concord issue remote preview close <number> --connection <id> [--reason completed|not_planned]
concord issue remote preview reopen <number> --connection <id>
concord issue remote apply <receipt-id> --connection <id> --authorize <target>
```

只支持 github.com 的 `transport: 'gh'` 连接，凭据只来自 gh 登录态（[凭据](../../architecture.md#凭据)）。远端写入由 `concord issue remote preview` 与 `concord issue remote apply` 提供，Web 与 action 不提供；本地 `docs/issues` 不因远端写入改变。

### preview

- 只读取远端，不写 docs。连接未记录 `repositoryId` 返回 `IssueConnectionUnbound`；plan 与 execute 先读取仓库并核对仓库 ID，不符返回 `ConnectionIdentityMismatch`，改名或转移后的旧名称不会把写入导向另一个仓库。
- 目标状态已等于计划结果时返回 `IssueNoChange`，不签发远端写入计划：close 已关闭、reopen 已打开、labels-add 的标签全已存在、labels-remove 的标签不存在、body-set 正文相同。目标是 Pull Request 返回 `IssueTargetIsPullRequest`。
- create 完整分页列出 open 与 closed Issues 并排除 Pull Request。带 `--origin-key` 的 machine-origin create 要求正文含 `payload-sha256:` 标记，前像是带同一 origin-key 的 Issue 集合，已存在时返回 `IssueCreateConflict`；manual create 的前像是标题完全相同的 Issue 集合。其它 Issue 的变化不构成漂移。
- labels-remove 每个远端写入计划只移除一个标签，重复 `--label` 返回 `InvalidInput`。标签名含控制字符或超过 50 个字符时拒绝。
- 远端写入计划有效期 5 分钟，只能消费一次。`authorize` 绑定动作、目标与 payload：编号目标为 `<operation>:<owner>/<repo>#<number>@<payload>`，create 为 `create:<owner>/<repo>@<payload>`。`<payload>` 是 `payloadDigest` 十六进制部分的前 12 位；同一目标重新计划不同正文或标签后，旧授权串不再匹配。

### apply

1. 读取并严格解码远端写入计划。`--connection` 必须是签发它的同一连接，`--authorize` 与它的目标完全相等；不等返回 `IssueAuthorizationMismatch`，不消费该计划，零远端调用。
2. 原子消费远端写入计划：过期返回 `IssuePlanExpired`，已消费返回 `IssuePlanConsumed`。
3. 重新读取远端前像，不符返回 `IssuePlanDrifted`，零写请求。
4. 恰好执行一次写请求。确定的 4xx 或 5xx 返回 `IssueRemoteRejected`（`details.status`）。结果不确定（超时、信号、无法解析响应）返回 `IssueMutationUncertain`，`details` 含 receiptId、issueOperation、target 与请求的 method 和 path。两者都保持远端写入计划已消费，不自动重试。

不确定之后必须重新 plan：已生效的 close、reopen、标签与正文写入返回 `IssueNoChange`；machine-origin create 重新完整扫描 origin-key，已生效时返回 `IssueCreateConflict`。manual create 与 comment-add 没有幂等键，错误消息要求人工核对远端后再计划。

### 预算

单次 gh 输出不超过 2 MiB；一次 plan 或 execute 的列表最多 200 页（每页 100 条）、累计 64 MiB，整个命令截止 120 秒。超出返回 `IssueRemoteBudgetExceeded` 或 `GhTimeout`，不签发远端写入计划，execute 不发出写请求。该预算不改变 Feedback 读取的预算。

### 输出与错误

| 输出 | `--json` 字段 |
| --- | --- |
| `issue remote preview` | `operation: "issue-plan"`、`receiptId`、`connection`、`issueOperation`、`target`、`payloadDigest`、`remotePreimageDigest`、`expiresAt`（ISO 8601 UTC）、`authorize` |
| `issue remote apply` | `operation: "issue-execute"`、`receiptId`、`issueOperation`、`issue`（`number`、`url`、`state`、`title`、`labels`） |

除上文错误码外，API token 连接返回 `IssueRemoteTransportUnsupported`，远端写入计划不存在或损坏返回 `IssuePlanNotPlanned` 或 `IssuePlanCorrupt`，gh 失败沿用 Feedback 读取的 `Gh*` 错误。内部写入计划存储、outcome 与写请求边界见[架构](architecture.md#远端-issue-写入)，gh 读取适配见 [Feedback 架构](../feedback/architecture.md#gh-读取适配)。
