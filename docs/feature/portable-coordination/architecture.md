# Short publication leases

Concord coordinates one worktree with Node file leases. HawDB remains a disposable cache. This page owns optimistic source access, exclusive commit, and recovery results. The user path is [Coordinate local publications](use-case/coordinate-local-publications.md).

The per-operation dependency matrix is in the [local SDLC architecture](../local-sdlc/architecture.md#操作依赖). Runner leases and evidence finalization are in the [project architecture](../../architecture.md#发布协调). Rationale: operation boundaries.

## Entity ownership

Source queries do not acquire publication ownership. They record file preimages, missing paths and directory membership, then verify them before returning.

A persistent publication revision advances when an exclusive owner enters and exits. A changed revision rejects the current result with SourceChanged. Unfinished journals still prevent a current successful snapshot.

Ordinary document mutations plan optimistically and acquire an exclusive lease only for commit. Commit verifies configuration, observations and the entire change set before writing the journal and publishing files. Concurrent plans cannot overwrite the winning writer. Explicit write snapshots protect runner transitions and recovery; they do not wrap ordinary queries.

Historical diagnostic projections live in HawDB and refresh asynchronously. Their [query contract](../local-data-engine/use-case/query-asynchronous-projections.md) defines freshness and failure behavior. They never authorize publication, check success or evidence decisions.

Runner state and database directory ownership retain their own boundaries. Persistent handles close before the source snapshot ends. Cache access never requires publication ownership.

## Access modes

LocalRepository takes an explicit `access: 'read' | 'write'`. Read uses optimistic source snapshots and rejects real publication. Ordinary write plans optimistically and takes the exclusive lease only to commit.

Dry-run decides whether a plan is published; it is independent of access, reuses optimistic snapshots and never authorizes publication. Existing `dryRun` callers keep preview semantics.

Every ordinary CLI query declares read, and CLI actions and Web share one action classification. Only external execution, recovery, cache rebuild/clear and document writes use write.

Constructing a repository does not retain a lease. Synchronous planning and reading run in short snapshots; interaction, network requests and test execution do not. Fixed-evidence validation and its Memory write share one snapshot. Cache updates during a read never justify taking the exclusive lease; when the cache cannot be used safely, the read falls back to sources.

## Data flow

A claim writes a complete owner file with a new token into a unique temporary directory beside the lease and fsyncs it. It renames the directory onto the lease path and fsyncs the parent before protected work. An occupied lease cannot be replaced. Unknown metadata, symlinks, extra files, failed durability or uncertain identity fail closed.

Release and dead-owner recovery unlink only the observed token file. Only a successful unlink may attempt a nonrecursive rmdir; ENOTEMPTY preserves a new owner.

The lease directory is never removed recursively or stolen by age. Close is idempotent. Ordinary write admission can reclaim an entirely dead observed set and retry once, without processing journals or runner ownership. Unknown hosts, live or reused PIDs, EPERM and unknown records preserve the scene.

Source queries do not reclaim live or dead publication tokens. Writers and recovery serialize changes; source readers detect drift. A historical cache hit remains readable during source publication when the cache engine is available.

Recover first records and reclaims observed dead publication tokens. It then selects the single journal under exclusive protection. Later engine stages do not reclaim again.

A new owner, even if it subsequently dies, makes this call Busy; a later explicit recovery records its reclamation. Ordinary or Trace recovery takes a fresh short exclusive snapshot, followed by final journal and runner verification.

That check uses the worktree-private coordination path directly. It does not require a configuration file to remain after init rollback. A concurrent publication can make the final check Busy. The earlier journal result is not a completed recovery in that case.

## Invariants

- Read access rejects publication. Dry-run expresses a preview and never publishes source changes or starts background refresh.
- Source reads validate observations and publication revision without shared ownership. Partial parsing follows the same rule.
- Prepared and committed journals remain recoverable; unknown edits cannot be overwritten.
- HawDB directory ownership and runner cleanup remain independent of query projections.
- Recovery success describes the verified coordination state, not the absence of journals alone.

## Errors

Competing writers report Busy. Multiple journals are a named conflict. That conflict is reported before the runner result, and the scene stays. Content that matches neither the preimage nor the planned digest stays for a person to judge.

The recovery result keeps operation, the journal outcome, and changedPaths. It also adds coordination. Publication lists reclaimedTokens. Runner status is absent, running, or blocked. Blocked carries a named reason.

With no transaction, absent or healthy running may return clean. An uncertain runner returns blocked and keeps the journal result actually produced.

If the first exclusive check already finds runner blocked, journal recovery does not start. Journal status is pending when a journal exists and clean when it does not. Changed paths is empty.

If the runner becomes blocked after journal handling, the completed journal status remains. The overall status becomes blocked. The CLI fails on blocked. Web and action return the same status fields.

## Identity and reuse

Each token is exact. Release and dead-owner recovery delete only that token. A new writer that arrives during recovery is not deleted. Independent worktrees do not share a lease. Only the current coordination protocol is supported. Prior lock formats are not migrated, and mixed executable versions are not coordinated.

## Trace 发布与恢复协议

`concord repo` 的关系写入、结构写入和 Feedback 信封导入共用一套 Trace 发布协议。基础 CLI 的本地 Issue 写入使用基础发布 journal，由 `concord recover` 恢复。两者争用同一 `publication.lease`，不并发发布。短期租约、读者准入与恢复结果见上文 [Access modes](#access-modes)，本节只声明 Trace 专属的 journal 与恢复规则。

### 协调目录与租约

协调状态位于 `git rev-parse --git-path concord/trace`，每个 worktree 独立。目录中有以下文件：

- `publication.lease`：短期发布租约，由 Node 文件租约实现。
- `coordination-id`：随机 UUID，用于 worktree 身份。
- 两种 journal：`publication-journal.json` 与 `multi-file-publication-journal.json`。

支持边界是单机本地文件系统。跨主机共享同一 worktree 不受支持；无法确认租约归属时 fail closed。

读者不取得租约。返回结果前，读者必须重新核对它读过的每个文件的摘要与目录集合，并确认没有未完成的 journal：

- 存在 journal 时返回 `TraceRecoveryRequired`，提示运行 `concord repo docs trace recover`。
- 任何读过的文件或目录集合变化时，按[一致读取](#一致读取)重试或失败。

读者不修改 owner 或 journal；首次读取可以初始化 coordination-id。

写者与 recover 只在提交阶段取得独占租约，先保守恢复旧 journal，再开始新的 publication。提交前的编译在已持有的租约下重新执行，不重新打开或升级锁。

### 一致读取

编译连续两次枚举并读取全部 Trace 输入。两次的路径集合与字节相同后，只用第二次的内存捕获编译；不同则最多重试三次，之后返回 `TraceInputChanged`。返回前再核对一次全部摘要、目录集合与 journal，变化返回 `TraceSnapshotChanged`。跨文件发布期间读到“旧 a 加新 b”时，末次核对会发现 a 已变化。

这只证明捕获前后一致，不证明线性快照。文件改回原来的字节（ABA）得到同一结论，无害。

### 文件发布

单文件与多文件 publication 的 journal 以 mode `0600` 写入，单个 owner 不超过 32 MiB。journal 记录以下内容：

- 每个文件的前像（字节、digest、mode）与 planned digest、mode。
- 当前阶段。
- HEAD、Git index 条目与 worktree 身份。

多文件 journal 的阶段依次为 `prepared` → `publishing` → `committed` → `cleanup`：

1. **prepared**：journal durable 后，在目标同目录写临时文件并 fsync。
2. **publishing**：逐个核对前像，rename 到目标并 fsync 目录。删除使用 planned `absent`。
3. **committed**：全部目标就位后，把 journal 的阶段 durable 改为 `committed`。这是唯一 commit point。
4. **cleanup**：删除 journal。

写者在 commit point 之后首次清理失败时，在同一独占租约内保守恢复。恢复证明 planned owner 完整后返回成功 receipt，不出现“已提交却报告未提交”的重试歧义。

### 目录发布

新 Feature 或 Design 目录先在同级 `.stage-<uuid>` 中构建 manifest，再原子 rename 到目标。Feedback 信封导入的 Issue owner 与附件使用多文件发布，每个新文件的前像为 `absent`。

回滚时先把目标原子移回 stage，再把 journal durable 切换到 `discarding-stage`。重复恢复只删除原 manifest 的精确剩余子集。

### 恢复规则

`trace recover` 按 journal 的阶段判断：

- 已到 `committed`：只在全部 owner 匹配 planned digest 且没有残留临时文件时完成 journal。
- 未到 `committed`：只在每个 owner 匹配前像或 planned digest 时回滚到前像并丢弃临时文件。
- 其它情形：返回 `TraceRecoveryConflict`，保留 owner、stage 与 journal。

以下变化同样返回 `TraceRecoveryConflict` 并保留现场：额外路径、symlink、特殊文件，以及 identity、HEAD、index、mode 或 digest 的变化。恢复从不改写与 journal 状态不符的 owner。

不使用 Trace 租约的编辑器在最终前像检查与 rename 之间仍有极窄的保存竞态。协议只保证已观察到的并发编辑会阻止 publication。

### 验收

每个 journal 阶段被中断后，结果只能是三种之一：完整旧状态、完整新状态，或保留 owner 与 journal 的具名冲突。领域测试覆盖以下注入点：rename 后、`committed` 写入后、`discarding-stage` 删除中，以及外部编辑冲突。
