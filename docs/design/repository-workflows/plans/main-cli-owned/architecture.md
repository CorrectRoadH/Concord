# 仓库工作流架构

## Trace 容错编译

`concord repo` 的 Trace 编译区分两种调用：

- `compileTrace(root)`：严格模式，遇到第一个不可隔离的错误即以原错误类型失败。
- `compileTraceReport(root)`：报告模式，返回 `{ snapshot, complete, findings }`。

报告模式只隔离可归因到单个测试源码文件的错误：

- `decodeCaseDeclarations` 失败，`@test-file` 指向的文件不存在。
- contract 目标无效或类型不符，suite 归属错误。
- `@regression` 目标不存在或不是 Problem Memory。
- 测试文件声明的 caseId 与 case history 的 tombstone 冲突。

该文件的全部 case 从 snapshot 中排除，不保留半个文件。

跨文件 caseId 重复不按枚举顺序归属：同一 caseId 的全部声明文件都记 `CaseIdConflict` finding（`conflictsWith` 列出其它路径，按路径排序），这些文件全部排除。新加入的文件不能挤掉已有文件，也不受文件系统枚举顺序影响。

Markdown owner、Memory、Issue、case history 文件自身与跨 owner 关系校验的错误仍整体失败，因为它们影响其它 owner 的关系。

`TraceFinding` 形如 `{ code, path, subject, message, suggestion?, conflictsWith? }`。代码为 `CaseAnnotationInvalid`、`CaseContractInvalid`、`CaseSuiteInvalid`、`CaseRegressionInvalid`、`CaseIdConflict`。存在 finding 时 `complete: false`。snapshot digest 按剩余内容计算，只用于展示，不作为任何写入的前像。

以下只读命令改用报告模式：

- `docs feature list/show`、`docs test list/show`、`docs trace`。
- `memory list/show/search/check`、`feedback list/show/export/check`。
- design、research、use-case 的只读子命令。

- JSON 结果增加 `complete` 与 `findings`；人读输出把每条 finding 以 `warning: <path>: <message>` 写到 stderr。
- list/show 在 `complete: false` 时仍退出 0；消费者用 JSON `complete` 判断结果是否完整，不用退出码判断。
- show 的目标 case 位于被排除文件时返回 `CaseExcluded`（附该文件的 finding），退出 1，不返回 NotFound。
- check 类命令（`memory check`、`feedback check`）把 finding 并入报告并退出 1。JSON 用 `violations` 与 `incomplete` 两组分开报告：前者是被检 owner 自身的违规，后者是 finding 造成的输入不完整（[C-010](../../../../constitution.md#c-010)）。

写命令按是否依赖测试关系分两类（[C-013](../../../../constitution.md#c-013)）：

| 类别 | 命令 | Trace finding 的影响 |
| --- | --- | --- |
| 依赖完整关系图 | `memory resolve` fixed、regression add/refresh/retire、case issue add/retire；删除、退役、取代或改名可能被测试标记引用的 Memory、Feature 或 Use Case；`trace recover` 后的复核 | 经过 `requireCompleteTrace`，有 finding 即拒绝 |
| 只新增或修改自身 owner | memory create/edit、Issue 写入、`repo feedback import`、Feature page add/set、design/research/use-case 创建 | 不因测试源码 finding 拒绝；自身与被引用 owner 仍严格校验 |

第二类命令不消费 case 关系，也不能使已有的测试标记失效，被排除文件里的标记不会因这类写入失去目标。它们在报告模式 snapshot 上校验被引用的 Markdown owner，写入前像取自被写 owner 自身的字节。基础 CLI 的本地 Issue 写入不编译 Trace。

第一类命令统一经过 `requireCompleteTrace`：

- 报告模式存在 finding 时以 `TraceIncomplete` 失败，`findings` 列出全部 finding，零写入。
- 不可隔离的错误保留原错误类型（如 `TraceFormatError`）。
- 通过后在同一 lease 内以严格模式编译，取得写入前像。

标记文案说明实际约束并给出建议：

- `@feature` 目标不匹配 `^docs/feature/(?!.*/use-case/).+/README\.md$`：`@feature must target a Feature package README (docs/feature/<package>/README.md); use @use-case for a leaf Use Case`。目标位于 `docs/feature/<package>/` 下时，`suggestion` 为 `docs/feature/<package>/README.md`；目标是 `use-case/` 下的路径时，建议改用 `@use-case <原路径>`。
- `@use-case` 目标不匹配叶子路径：`@use-case must target a leaf Use Case (docs/feature/<package>/use-case/<name>.md)`；目标是 Feature README 时建议改用 `@feature`。
- 基础 CLI `concord test annotate` 的同类诊断使用相同文案。

## 远端 Issue 写入

`concord issue` 增加两个子命令组。远端只支持 github.com，只通过 `transport: 'gh'` 的 `feedbackConnections` 连接；凭据来自运行 Concord 的机器上的 gh 登录态。API token 连接返回 `IssueRemoteTransportUnsupported`。

远端写入只由 CLI 与宿主组合的同一贡献提供。Web 与 action 不提供 plan 或 execute，不新增远端写入 action。

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

plan 的行为：

- 只读取远端，不写 docs。
- 目标状态已等于计划结果时返回 `IssueNoChange`，不签发 receipt：close 已关闭的 Issue、reopen 已打开的 Issue、labels-add 的全部标签已存在、labels-remove 的全部标签都不存在、body-set 的正文与当前相同。
- 编号目标读取该 Issue 当前状态并计算前像 digest；目标是 Pull Request 时返回 `IssueTargetIsPullRequest`。
- create 完整分页列出 open 与 closed Issues，过滤 Pull Request 后计算前像。machine-origin create 的前像是带同一 origin-key 的 Issue 集合（应为空）；manual create 的前像是与计划标题完全相同的 Issue 集合。其它 Issue 的变化不构成漂移。
- `--origin-key` 选择 machine-origin：正文必须带 `payload-sha256:` 标记，并按现有 `requireUnseenMachineOrigin` 判定。不带 origin key 的是 manual create。
- receipt 写入 Git-private `concord/issue-plan/v1/planned/<receipt-id>.json`（mode 0600），有效期 5 分钟。

plan 的 JSON 字段见[公开输出契约](#公开输出契约)，`expiresAt` 为 ISO 8601 UTC 字符串。`authorize` 是执行时必须原样提供的目标串，绑定动作、目标与 payload：

- 编号目标：`<operation>:<owner>/<repo>#<number>@<payload>`，例如 `close:example/product#12@3f9a1c2b7d4e`。
- create：`create:<owner>/<repo>@<payload>`。
- `<payload>` 是 `payloadDigest` 十六进制部分的前 12 位。为同一目标重新计划不同正文或标签时，旧授权串不再匹配。

execute 的行为：

1. 从 store 读取并严格解码 receipt。
2. 核对 `--connection` 指向的仓库与 receipt 一致，`--authorize` 与 receipt 目标完全相等；不等返回 `IssueAuthorizationMismatch`，不消费 receipt，零远端调用。
3. 原子消费 receipt：过期返回 `IssuePlanExpired`，已消费返回 `IssuePlanConsumed`。
4. 重新读取远端前像，与 receipt 不符返回 `IssuePlanDrifted`。
5. 执行恰好一次写请求。

`--authorize` 表达调用方声明的当次授权，不是凭据，Concord 不保存授权记录。授权串可以从 plan 输出读出，Concord 无法区分人与 Agent 的调用，也不证明授权真实存在：

- Agent 只有在用户就该授权串（或其包含的动作、目标与 payload）明确同意后，才能传入 `--authorize`。
- Agent 不得因为 plan 成功、工具可用或权限宽松而自行推断授权（[C-007](../../../../constitution.md#c-007)）。
- `concord --skill feedback` 与 init 随包指引写明这条规则。

receipt store 防止误用与并发重放，不防御能直接改写 Git-private 目录的本地进程。

写请求发出后结果不确定（超时、进程信号、无法解析响应）时返回 `IssueMutationUncertain`，receipt 保持已消费。`details` 包含 receiptId、issueOperation、target 与请求的 method 和 path。Concord 不自动重试。

之后必须重新 plan：

- 若写入已生效，close、reopen、labels 与 body-set 的重新 plan 返回 `IssueNoChange`。
- machine-origin create 的重新 plan 会完整扫描 origin-key，已生效时返回 `IssueCreateConflict`。
- manual create 与 comment-add 没有幂等键，错误消息说明需要人工核对远端后再计划。

execute 在消费后把结果写入 `concord/issue-plan/v1/consumed/<receipt-id>.outcome.json`（mode 0600），不含凭据或响应正文。每个已消费的 receipt 恰好有一个 outcome，状态取以下之一：

- `applied`：写请求成功。
- `drifted`：重新读取的远端前像与 receipt 不符，没有发出写请求。
- `aborted`：写请求发出前失败，例如 `ConnectionIdentityMismatch`、读取预算超限或 gh 读取失败；`code` 记录具名错误，没有发出写请求。
- `rejected`：写请求返回确定的 4xx 或 5xx，`status` 记录 HTTP 状态。
- `uncertain`：写请求已发出，结果不确定。

只有 `uncertain` 表示远端可能已改变。outcome 写入失败不改变命令返回的错误，receipt 仍保持已消费。

预算与边界：

- 单次 gh 输出不超过 2 MiB。
- 一次 plan 或 execute 的列表最多 200 页（每页 100 条）、累计 64 MiB，整个命令的截止时间为 120 秒；超出返回 `IssueRemoteBudgetExceeded` 或 `GhTimeout`，不签发 receipt，execute 不发出写请求。这组预算属于 Issue 远端操作，不改变 feedback 读取的 16 MiB 与 30 秒预算。
- gh 调用沿用 `feedback-gh` 的可信可执行文件、环境裁剪与进程组回收。
- 写请求的 JSON 正文只经 stdin 传给 `gh api --input -`。不使用 `-f`、`-F`、`--field` 或 `--raw-field`，因为 `-F` 会把以 `@` 开头的值当作本地文件读取。
- 路径段（owner、repo、标签名）经 `encodeURIComponent` 编码；标签名含控制字符或超过 50 个字符时 plan 拒绝。
- 写方法只在 execute 路径开放，固定为以下请求，路径只能是 `repos/<owner>/<repo>/issues...`：
  - `POST issues`
  - `PATCH issues/<n>`：body-set 只带 `body`，close 只带 `state: "closed"` 与可选 `state_reason`，reopen 只带 `state: "open"`
  - `POST issues/<n>/labels`
  - `DELETE issues/<n>/labels/<name>`：labels-remove 每个 receipt 只移除一个标签，重复 `--label` 返回 `InvalidInput`；移除多个标签需要分别 plan 与授权
  - `POST issues/<n>/comments`
- 远端写入要求连接已记录 `repositoryId`，否则 plan 返回 `IssueConnectionUnbound`。plan 与 execute 先读取 `repos/<owner>/<repo>` 并核对仓库 ID，不一致返回 `ConnectionIdentityMismatch`，零写请求。仓库改名或转移后，旧名称不会把写入导向另一个仓库。
- receipt 记录 connection ID 与 repositoryId；execute 的 `--connection` 必须是同一连接。
- 写请求返回确定的 4xx 或 5xx 状态时返回 `IssueRemoteRejected`（`details.status`），receipt 保持已消费，不自动重试。

远端写入不改本地 Issue owner。需要在本地记录远端编号时，使用既有 `origin` 或后续独立契约。

领域实现位于 `repository/issue/`，以 `issueRemoteCommandContribution` 导出，基础 CLI 挂载为 `concord issue plan|execute`。宿主可以挂载同一贡献。

## 本地 Issue 单一写入口

`docs/issues/<id>.md`（`kind: issue`）只由 `concord issue` 写入：

| 子命令 | 行为 |
| --- | --- |
| `draft`、`create` | 不变 |
| `edit`、`remove` | 不变 |
| `link <id> --memory <ref> [--kind investigation\|root-cause\|decision\|delivery]` | kind 默认 investigation |
| `adopt <id> --to <ref>` | 加入 `adoptions.current`；目标为 Roadmap、Feature、Use Case 或 Engineering 的 exact ref |
| `retire <id> --from <ref>` | 从 current 移除，并以当前 HEAD 追加 `adoptions.history` |
| `close <id> --kind <kind> ...` | kind 取 fixed、delivered、duplicate、declined、invalid、external-fixed、closed，参数与校验同现有 `IssueClosureSchema`；省略 `--kind` 等同 `--kind closed --reason <text>` |
| `reopen <id> --reason <text>` | 移除 closure，追加 history |

校验与 `concord check` 的 Issue 规则使用同一实现：

- fixed 需要已按 fixed 结论解决的 Problem，declined 需要 current Decision。
- duplicate 需要无环 canonical Issue。
- declined、invalid、duplicate 需要先 retire 全部 current adoption。

两个既有写入口的前置条件取并集，合并后只保留一份状态转换实现：

- close 的全部 kind 都要求 `memoryRelations` 中没有 captured 或 open 的 Problem，否则返回 `OpenProblem`。
- link、adopt 只接受 draft Issue；closed Issue 先 reopen。
- link 按 `(kind, memory)` 去重。
- retire 记录的 commit 是执行时的 HEAD。仓库没有提交时返回 `IssueRetireRequiresCommit`，零写入。
- adopt 的目标解析与校验使用基础文档加载器，不读取 `concord.repository.json`，也不要求 Trace 完整。目标是 canonical owner 路径；带 anchor 的 ref 只在 `concord check` 同样校验该 anchor 时接受。

这些都是写入前置条件。`IssueClosureSchema`、`adoptions`、`memoryRelations` 与 history 条目的结构与含义不变，已有 Issue 文件无需迁移。

全部本地 Issue 写入使用基础 CLI 的单文件发布 journal（`concord recover` 恢复）。`concord repo feedback import` 创建 Issue 目录时仍使用 Trace 多文件发布（`concord repo docs trace recover` 恢复）。两条路径争用同一 `publication.lease`，不会并发发布。

`concord feedback` 只负责外部来源：`connection`、`sync`、`import <url>`、`list`、`show`。`concord repo feedback` 只保留 `import`（信封）、`export`、`list`、`show`、`check`。

Web 与 action 改用 `issue.adopt`、`issue.retire`、`issue.reopen`，`issue.close` 与 `issue.link` 接受新增字段。`issue.close` 省略 `kind` 时等同 `kind: "closed"`，既有请求的含义不变。

宿主不组合本地 Issue 写命令，直接调用 `concord issue`。

help 文案：

- `issue`：`Maintain local Issue owners; remote GitHub writes only through plan and execute.`
- `feedback`：`Connect external feedback sources and import observations as local Issues.`
- `repo feedback`：`Import and export downstream Feedback envelopes; inspect and validate Issues.`
- 每个子命令的描述使用 Issue 一词，不混用 Feedback。

## 退役与迁移

退役命令保留在命令树中，返回 `CommandRetired`，退出 1，零写入；错误消息给出替代命令。退役命令接受并忽略任意位置参数与选项，旧调用的参数不会先触发解析错误而掩盖 `CommandRetired`。JSON 错误的 `details` 为 `{ command, replacement }`：

| 退役命令 | 替代命令 |
| --- | --- |
| `concord feedback create` | `concord issue create` |
| `concord feedback link --feature` | `concord issue adopt --to` |
| `concord feedback close` | `concord issue close` |
| `concord repo feedback link` | `concord issue link --kind` |
| `concord repo feedback adopt` | `concord issue adopt` |
| `concord repo feedback retire` | `concord issue retire` |
| `concord repo feedback close` | `concord issue close --kind` |
| `concord repo feedback reopen` | `concord issue reopen --reason` |

action `feedback.link` 返回同一错误。Issue 文件格式、`IssueClosureSchema` 与 history 条目不变。`runFeedbackCommand` 的 link/adopt/retire/close/reopen operation 返回同一具名错误；只读与信封 operation 保留。

退役随 Concord 版本发布，没有双写过渡期。采用本方案时同步修订以下声明这些命令的契约与随包指引：

- [Feedback CLI](../../../../feature/feedback/cli.md)
- [本地观察](../../../../feature/feedback/use-case/manage-local-observations.md)
- `skills/concord/references/feedback.md`

消费者宿主升级 Concord 包时，把 `repo feedback link/adopt/retire/close/reopen` 的调用改为 `concord issue`。

## 命令贡献与组合

`repository/contribution.ts` 定义通用贡献：

```ts
export interface RepositoryCommandContribution<Name extends string = string, R = never> {
  readonly name: Name;
  readonly summary: string;
  readonly makeCommand: (deliver: TerminalDeliverySink) => Command.Command<any, never, unknown, never, R>;
}
```

`DocsCommandContribution` 是 `R = NodeServices` 的别名。每个贡献在类型中声明它需要的服务，宿主在组合边缘提供对应 Node 层。导出：

- `feedbackCliContribution`（需要 `FeedbackStore`）、`memoryCliContribution`（需要 `MemoryStore`）：从 `repository/cli.ts` 移出的完整 verbs、options 与 help。
- `issueRemoteCommandContribution`（需要 `IssueRemote`、`IssuePlanStore` 与项目配置读取）、`docsWorkCommandContribution`（需要 `NodeServices` 与项目配置读取）。
- `repository/cli-support.ts`：`readText`、`readJson`、`emit`、`jsonOption`、`dryRunOption`、`renderUnhandledError`。
- `runComposedCli(command, { version })`：统一错误渲染。

`runComposedCli` 的输出契约：

- 未知子命令只向 stderr 输出 `UnknownSubcommand: "<name>" for "<parent>"; run <parent> --help`，退出 1，不打印 help 与内部 `ShowHelp` 行。
- 解析错误同样只输出一条具名错误，代码为 `InvalidInput`。
- `--help` 以及只输入命令组名、未给子命令时，向 stdout 打印该组 help 并退出 0。
- 参数中有 `--json` 时，任何失败都向 stderr 输出一行 `{ "ok": false, "error": <code>, "message": <text>, "details"?: <object> }`，退出 1，与基础 CLI 的错误形状相同。未知子命令的 `details` 为 `{ name, parent }`。
- 领域错误的 `error` 取其 `_tag`。未声明的异常使用 `RepositoryToolError`，消息不含凭据与环境变量值（[C-012](../../../../constitution.md#c-012)）。

`concord repo` 本身用这些贡献与 `runComposedCli` 组合，消费者宿主组合同一份对象，不复制命令定义。

## Docs Work

`concord docs work` 把已定稿的文档目标切成互斥写集，为每份交付运行项目声明的检查，并由一个 finalizer 收尾。它不启动、分派或等待 Agent。

```text
concord docs work prepare (--scope <path>... | --plan <file|->) [--base <commit>] [--run-id <id>]
concord docs work show <run-id>
concord docs work check <run-id> <item-id> --report
concord docs work check <run-id> <item-id> --verify <reported-receipt-digest>
concord docs work finalize <run-id>
```

项目配置 `concord.config.ts` 可选字段：

```ts
docsWork?: {
  checks?: Record<string, { argv: readonly string[]; timeoutMs?: number }>;
  finalizer?: { argv: readonly string[]; timeoutMs?: number };
  sharedPaths?: readonly string[];
}
```

argv 中恰为 `{paths}` 的元素展开为该检查对应 item 当前 write 集合的文件列表；不经过 shell，cwd 为仓库根。展开后 argv 总长超过 128 KiB 时检查以 `DocsWorkArgvTooLong` 失败，不截断路径。`timeoutMs` 默认 600000，超时或取消回收进程组。检查命令的退出码为 0 视为 passed，其它值、超时或信号视为 failed。

prepare 记录项目配置文件与 `docsWork` 解析结果的 `configDigest`。check、verify 与 finalize 先重新计算，不一致返回 `DocsWorkConfigChanged`，不运行任何检查。item 不能通过修改项目配置替换自己的检查命令。

省略配置时有两个内建行为：

- 内建检查 `writing`：对 write 路径运行 `concord docs check` 默认规则。
- 内建 finalizer：进程内 `concord check`。

`sharedPaths` 默认为 `docs/README.md` 以及仓库中存在的 `docs/concepts.json`、`docs/concord-writing.json`。项目配置文件始终视为共享路径。

### 计划输入

`--plan` 读取 `concord.docs-work-plan/v1`：

```ts
interface DocsWorkPlanV1 {
  format: "concord.docs-work-plan/v1";
  items: readonly {
    id: string;                 // [A-Za-z0-9][A-Za-z0-9_-]{0,127}，run 内唯一
    goal: string;
    write: readonly string[];   // 文件路径、目录路径（以 / 结尾）或 glob
    read?: readonly string[];   // 路径或 glob，默认 []
    blockedBy?: readonly string[];
    checks?: readonly string[]; // 配置的检查 ID，默认 ["writing"]
  }[];
}
```

`--scope <path>` 可重复，每个 scope 生成一个 item：write 为该路径，ID 取路径末段，goal 为 `Update <path>`，read 为空，checks 默认。两个 scope 末段相同时返回 `DocsWorkPlanInvalid`（`DuplicateItemId`），要求改用 `--plan`。

`--run-id` 必须匹配 `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`，且该 run 目录不存在；否则返回 `DocsWorkRunExists` 或 `DocsWorkPlanInvalid`。

### 规划校验

glob 支持段内 `*` 与跨段 `**`。路径必须是 canonical 仓库相对路径，拒绝绝对路径、`..`、symlink 组件与超出仓库的 realpath。

write 条目是 item 拥有的范围，不是一次性快照：

- 文件路径可以尚不存在，用于新建页面。
- 目录路径与 glob 在每次 check 时按当前工作树重新匹配，item 新建、删除的文件都计入 write 集合。
- prepare 时目录与 glob 的匹配数不超过 10000；read 条目的匹配数为 1 到 10000，匹配为空返回 `DocsWorkPlanInvalid`（`EmptyRead`）。
- 匹配在 base 提交的 tracked 文件与工作树 nonignored untracked 文件中进行。

重叠判定按条目的字面前缀（第一个含通配符的路径段之前的部分）保守计算：两个前缀互为祖先即视为重叠，即使展开结果暂不相交。

prepare 聚合以下全部错误，返回 `DocsWorkPlanInvalid`（`problems: { code, item?, path?, message }[]`），零写入：

- write 为空，或未知检查 ID。
- 两个 item 的 write 重叠，或 item ID 重复。
- write 命中 sharedPaths。
- A 的 write 命中 B 的 read，而 B 未直接或传递 blockedBy A。
- blockedBy 指向未知 item，或依赖成环。
- 任一 item 的 read 或 write、或 sharedPaths 中有已暂存、未暂存或未跟踪的改动（`git status --porcelain=v1 -z -- <paths>`）。错误逐条列出路径与所属 item。
- `--base` 不是 HEAD 的祖先提交。省略时 base 为 HEAD。

声明范围之外的改动不阻止 prepare，也不进入任何 digest。

### 状态与收据

run 写入 Git-private `concord/docs-work/v1/<run-id>/`：

- `run.json`：`concord.docs-work-run/v1`，包含 runId、baseCommit、createdAt、configDigest、sharedPaths、展开后的 items，以及 prepare 时的 `readDigest`。
- `receipts/<item>.reported.json`、`receipts/<item>.verified.json`。
- `finalize.json`。

`run-id` 默认由 Clock 时间与随机后缀生成。同一 run 的写操作取得 run 目录内的独占文件锁，文件以临时文件、fsync、rename 原子替换。锁被占用时返回 `DocsWorkBusy`。中断只会留下以 `.tmp-` 开头的临时文件，下次持锁时删除，已发布的 run、receipt 与 finalize 文件不被改写。

run 状态只属于当前 worktree，不进入 Git，也不是第二份计划或索引。Concord 不自动删除 run 目录；`docs work show` 列出它的位置。

check 的步骤：

1. 计算 write 集合的当前 digest 与 changedPaths。changedPaths 指 write 集合内相对 baseCommit 有变化的路径。
2. 核对 read 集合：排除本 item 与其直接或传递 blockedBy item 的 write 集合后，read 集合 digest 必须等于 prepare 时的值；sharedPaths 也必须未变。否则返回 `DocsWorkReadChanged`（列出变化路径），不写 receipt。
3. 依次运行检查。

收据格式：

```ts
interface DocsWorkReceiptV1 {
  format: "concord.docs-work-receipt/v1";
  runId: string; itemId: string; baseCommit: string; checkedAt: string;
  configDigest: string; readDigest: string; writeDigest: string; changedPaths: readonly string[];
  status: "reported" | "verified";
  reportedReceipt?: string;   // verified 时为 reported 收据的 digest
  dependencies?: readonly { itemId: string; verifiedReceipt: string }[]; // verified 时为各 blockedBy item 当前 verified 收据的 digest
  checks: readonly { id: string; status: "passed" | "failed"; exitCode: number | null; outputDigest: string; summary: string }[];
}
```

`summary` 取输出末尾不超过 4 KiB。检查失败时仍写入 reported 收据并标记 failed，命令退出 1。

reported 收据的 digest 是其规范 JSON 的 sha256，在 check 输出中返回。

`--verify` 的条件与行为：

- 当前 reported 收据的 digest 等于参数，writeDigest 未变，且全部检查为 passed；否则返回 `DocsWorkReceiptMismatch`。read 核对不通过返回 `DocsWorkReadChanged`。
- 每个 blockedBy item 已有 verified 收据，否则返回 `DocsWorkDependencyUnverified`。
- 然后重新运行同一检查，全部通过才写 verified，并记录 dependencies。

reported 收据只是 Agent 的自报；verified 由父 Agent 重新执行检查得到，不信任 reported 中的检查结果。

Docs Work 无法在共享工作树中把 write 集合之外的改动归因到某个 item，因此不报告越界改动。写入其它 item 的 write 集合会使那个 item 的 writeDigest 变化，在其 verify 或 finalize 时被拒绝；写入任何 item 都未声明的路径不被发现，父 Agent 用 diff 验收这部分。verified 只说明声明范围内的内容通过了声明的检查（[C-004](../../../../constitution.md#c-004)）。

finalize 的步骤：

1. 要求 configDigest 未变；每个 item 有 verified 收据，writeDigest 与 read 核对仍等于当前内容；每个 verified 收据记录的 dependencies 等于对应 item 当前 verified 收据的 digest。否则返回 `blocked` 并按 item 列出原因，不运行 finalizer，退出 1。
2. 运行 finalizer，结果写入 finalize.json，状态为 `finalized` 或 `failed`；failed 退出 1。finalizer 可以写 sharedPaths。
3. 已有 `finalized` 结果时再次 finalize 返回 `DocsWorkFinalized`，不重新运行。

finalize 不合并 diff，不修改 docs。

实现位于 `repository/docs/work/`，使用 Effect `FileSystem`、`Clock` 与 `ChildProcessSpawner`。以 `docsWorkCommandContribution` 导出，基础 CLI 挂载为 `concord docs work`。

## 公开输出契约

以下 JSON 字段、错误码与退出码是公开契约（[C-015](../../../../constitution.md#c-015)），采用后由对应 Use Case 与 CLI 页面声明。

退出码：0 表示成功，或报告模式的 list/show 返回了带 `complete: false` 的结果。1 表示任何具名失败、check 有违规或不完整、Docs Work 检查失败、finalize 为 `blocked` 或 `failed`。

失败统一输出 `{ ok: false, error, message, details? }`。

| 输出 | 字段 |
| --- | --- |
| Trace 只读结果 | 既有字段加 `complete: boolean`、`findings: TraceFinding[]` |
| check 类结果 | `ok`、`complete`、`violations`、`incomplete`（finding 列表） |
| `issue plan` | `operation: "issue-plan"`、`receiptId`、`connection`、`issueOperation`、`target`、`payloadDigest`、`remotePreimageDigest`、`expiresAt`、`authorize` |
| `issue execute` | `operation: "issue-execute"`、`receiptId`、`issueOperation`、`issue`（`number`、`url`、`state`、`title`、`labels`） |
| `docs work prepare`、`show` | `operation`、`runId`、`baseCommit`、`configDigest`、`items`（`id`、`goal`、`write`、`read`、`blockedBy`、`checks`）、`statePath` |
| `docs work check` | `operation: "docs-work-check"`、`receipt`（`DocsWorkReceiptV1`）、`receiptDigest` |
| `docs work finalize` | `operation: "docs-work-finalize"`、`status`（`finalized`、`failed`、`blocked`）、`blocked?`（`{ itemId, reason }[]`）、`finalizer?`（`exitCode`、`outputDigest`、`summary`） |

| 领域 | 错误码 |
| --- | --- |
| Trace | `TraceIncomplete`（`details.findings`）、`CaseExcluded`；既有 `TraceFormatError` 等不变 |
| 远端 Issue | `IssueRemoteTransportUnsupported`、`IssueConnectionUnbound`、`ConnectionIdentityMismatch`、`IssueTargetIsPullRequest`、`IssueNoChange`、`IssueCreateConflict`、`IssueAuthorizationMismatch`、`IssuePlanExpired`、`IssuePlanConsumed`、`IssuePlanNotPlanned`、`IssuePlanCorrupt`、`IssuePlanDrifted`、`IssueRemoteBudgetExceeded`、`IssueRemoteRejected`、`IssueMutationUncertain`，以及既有 `Gh*` 错误 |
| 本地 Issue | `CommandRetired`（`details.command`、`details.replacement`）、`OpenProblem`、`IssueRetireRequiresCommit`，以及既有 `InvalidIssueState`、`DuplicateLink` |
| Docs Work | `DocsWorkPlanInvalid`（`details.problems`）、`DocsWorkRunExists`、`DocsWorkBusy`、`DocsWorkConfigChanged`、`DocsWorkReadChanged`、`DocsWorkDependencyUnverified`、`DocsWorkReceiptMismatch`、`DocsWorkArgvTooLong`、`DocsWorkFinalized` |
| 组合 CLI | `UnknownSubcommand`（`details.name`、`details.parent`）、`InvalidInput` |

`DocsWorkPlanInvalid.problems[].code` 的取值：

- 输入：`EmptyWrite`、`EmptyRead`、`UnknownCheck`、`DuplicateItemId`、`UnsafePath`、`GlobLimit`、`BaseNotAncestor`。
- 写集：`WriteOverlap`、`SharedPathWrite`、`DirtyPath`。
- 依赖：`UndeclaredDependency`、`UnknownDependency`、`DependencyCycle`。

## 验收

所有验收在打包后公开 CLI 与隔离 Git 消费者中执行：

- C1：一个坏 `@feature` 文件不影响 list/show；check 退出 1 并列出 finding；fixed 与关系写入以 `TraceIncomplete` 零写入失败；文案与 suggestion 正确。
- C1 另含：测试文件声明的 caseId 与 case history 的 tombstone 冲突时只排除该文件；存在 finding 时 memory create 与 Issue close 仍成功。
- caseId 由 native 文件、声明文件与标题派生，公开输入无法让两个不同声明文件得到同一 caseId。对称排除作为防御保留，其分组逻辑以真实解码后的 case 输入做领域测试，不 fake 派生函数，也不声称公开 CLI 覆盖。
- C2、C3：用 fake gh 可执行文件（只模拟外部边界）记录请求。
  - plan 无写请求；授权不符、payload 前缀不符、过期、已消费、漂移、仓库 ID 不符零写请求。
  - 正常 execute 恰好一次写请求，正文经 stdin 传入。
  - PR 目标、未绑定仓库 ID、目标已是计划状态与预算超限具名失败。
  - 写请求超时返回 `IssueMutationUncertain`，重新 plan close 返回 `IssueNoChange`。
- C4：在没有 `concord.repository.json` 的消费者中验证本地 Issue。
  - `concord issue` 完成 link、adopt、retire、全部 close kind 与 reopen。
  - 关联 open Problem 时任何 kind 的 close 返回 `OpenProblem`。
  - 带旧参数的退役命令返回 `CommandRetired` 且零写入。
  - 既有 Issue 文件在 `concord check` 与 `concord repo feedback check` 中的判定不变。
- C5、C6：
  - scope 外脏文件不阻止 prepare；scope 内脏文件、重叠、重复 ID、未声明依赖、环与未知检查聚合拒绝。
  - 目录 write 中新建的文件计入 writeDigest。
  - 检查失败、read 变化、配置变化、依赖未 verified、verify digest 不符与 finalize 阻塞均具名。
  - 依赖 item 重新 verified 后下游 finalize 返回 blocked。
- C7：最小宿主组合 `feedbackCliContribution`、`memoryCliContribution` 与 `runComposedCli`。
  - help 与 `concord repo` 一致；只输入命令组名时打印 help 并退出 0。
  - 未知子命令只输出一条错误并退出 1，带 `--json` 时输出一行 JSON 错误。
