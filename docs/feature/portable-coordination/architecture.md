# Short publication leases

Concord coordinates one worktree with Node file leases. HawDB remains a disposable cache. This page owns optimistic source access, exclusive commit, and recovery results. The user path is [Coordinate local publications](use-case/coordinate-local-publications.md).

The per-operation dependency matrix is in the [local SDLC architecture](../local-sdlc/architecture.md#操作依赖). Runner leases and evidence finalization are in the [project architecture](../../architecture.md#发布协调). Rationale: [operation boundaries](../../design/operation-boundaries/DECISION.md).

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
