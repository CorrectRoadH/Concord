# 并行切分文档工作

## 用户目标

父 Agent 在多人共享的工作树上，把已定稿的文档目标切成互斥写集交给不同 Agent，并用可重新执行的检查收据验收每份交付，最后由一个 finalizer 收尾。

## 完整路径

1. 项目可在 `concord.config.ts` 的 `docsWork` 中声明检查命令、finalizer 与共享路径。
2. 父 Agent 编写计划并运行 `concord docs work prepare --plan plan.json --json`，或用 `--scope <path>` 切单个目录。prepare 只要求声明的 read、write 与共享路径干净。
3. 父 Agent 把 item 交给 Agent。Agent 完成后运行 `check <run> <item> --report`。
4. 父 Agent 独立核对 diff，用 `check <run> <item> --verify <digest>` 重跑检查。被依赖的 item 必须先 verified。
5. 全部 item verified 后运行 `finalize <run>`，执行配置的 finalizer。

## 命令与配置

```text
concord docs work prepare (--scope <path>... | --plan <file|->) [--base <commit>] [--run-id <id>]
concord docs work show <run-id>
concord docs work check <run-id> <item-id> --report
concord docs work check <run-id> <item-id> --verify <reported-receipt-digest>
concord docs work finalize <run-id>
```

```ts
docsWork?: {
  checks?: Record<string, { argv: readonly string[]; timeoutMs?: number }>;
  finalizer?: { argv: readonly string[]; timeoutMs?: number };
  sharedPaths?: readonly string[];
}
```

- argv 不经过 shell，cwd 为仓库根；恰为 `{paths}` 的元素展开为对应 item 当前 write 集合的文件列表。展开后超过 128 KiB 返回 `DocsWorkArgvTooLong`，不截断路径。`timeoutMs` 默认 600000；退出码 0 为 passed，其它退出码、超时或信号为 failed。
- 省略时内建检查 `writing` 对 write 路径运行 `concord docs check` 默认规则，内建 finalizer 运行 `concord check`。
- `sharedPaths` 默认为 `docs/README.md` 及存在的 `docs/concepts.md`、`docs/concord-writing.json`；项目配置文件始终是共享路径。
- prepare 记录配置文件与 `docsWork` 解析结果的 `configDigest`；之后 check、verify 与 finalize 发现不一致时返回 `DocsWorkConfigChanged`，不运行检查。item 不能通过修改配置替换自己的检查。

## 计划与规划校验

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

prepare 聚合全部问题，返回 `DocsWorkPlanInvalid`（`details.problems: { code, item?, path?, message }[]`），零写入：

| code | 条件 |
| --- | --- |
| `EmptyWrite`、`EmptyRead`、`UnknownCheck`、`DuplicateItemId`、`UnsafePath`、`GlobLimit`、`BaseNotAncestor` | 输入无效；`--base` 不是 HEAD 的祖先 |
| `WriteOverlap`、`SharedPathWrite`、`DirtyPath` | write 重叠或命中共享路径；read、write 或共享路径中有已暂存、未暂存或未跟踪的改动，逐条列出路径与 item |
| `UndeclaredDependency`、`UnknownDependency`、`DependencyCycle` | A 的 write 命中 B 的 read 而 B 未直接或传递 blockedBy A；依赖未知或成环 |

## 收据与收尾

- check 先核对 read：排除本 item 及其直接或传递 blockedBy item 的 write 后，read 与共享路径的 digest 必须等于 prepare 时的值，否则返回 `DocsWorkReadChanged`（列出路径），不写收据。然后依次运行检查，写入 reported 收据；检查失败时收据标记 failed 并退出 1。
- `--verify` 要求当前 reported 收据 digest 等于参数、writeDigest 未变且全部检查 passed，否则返回 `DocsWorkReceiptMismatch`。每个 blockedBy item 已有 verified 收据，否则返回 `DocsWorkDependencyUnverified`。随后重新运行同一检查，全部通过才写 verified 并记录依赖的 verified 收据 digest。reported 是 Agent 的自报，verified 不信任其中的结果。
- finalize 要求 configDigest 未变，每个 item 的 verified 收据、writeDigest 与 read 核对仍有效，且记录的依赖等于对应 item 当前 verified 收据；否则返回 `blocked` 并按 item 列出原因，不运行 finalizer，退出 1。finalizer 可以写共享路径，结果为 `finalized` 或 `failed`（退出 1）；已 finalized 后再次运行返回 `DocsWorkFinalized`。同一 run 的写操作被占用时返回 `DocsWorkBusy`。

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

| 输出 | `--json` 字段 |
| --- | --- |
| `prepare`、`show` | `operation`、`runId`、`baseCommit`、`configDigest`、`items`（`id`、`goal`、`write`、`read`、`blockedBy`、`checks`）、`statePath` |
| `check` | `operation: "docs-work-check"`、`receipt`、`receiptDigest` |
| `finalize` | `operation: "docs-work-finalize"`、`status`（`finalized`、`failed`、`blocked`）、`blocked?`（`{ itemId, reason }[]`）、`finalizer?`（`exitCode`、`outputDigest`、`summary`） |

verified 只说明声明范围内的内容通过了声明的检查（[证据的范围](../../local-sdlc/scope.md#证据的范围)）：写入其它 item 的 write 会在那个 item 的 verify 或 finalize 时被拒绝，任何 item 都未声明的路径上的改动不被报告，由父 Agent 的 diff 验收负责。Docs Work 不启动、等待或关闭 Agent，不合并 diff，不修改 docs。run 状态只属于当前 worktree，不进入 Git，不自动删除；`show` 列出其位置。

## 验收

在打包后公开 CLI 与隔离 Git 消费者中：

- scope 外脏文件不阻止 prepare；表中各问题聚合拒绝且零写入。
- 目录 write 中新建的文件计入 writeDigest。
- 检查失败、read 变化、配置变化、依赖未 verified、verify digest 不符与 finalize 阻塞均具名。
- B 依赖 A 且已 verified 后 A 重新 verified，finalize 返回 blocked 并要求 B 重新 verified。

状态文件与互斥见[架构](../architecture.md#docs-work)。

## Spec 来源

- [决策依据](../../../design/repository-workflows/DECISION.md)
