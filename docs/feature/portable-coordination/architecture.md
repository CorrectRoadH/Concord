# Short publication leases

Concord coordinates one worktree with Node file leases. HawDB remains a disposable cache. This page owns access, shared admission, and recovery results. The user path is [Coordinate local publications](use-case/coordinate-local-publications.md). Document dependency scope is in the [local SDLC architecture](../local-sdlc/architecture.md). The precise operation matrix is the [scoped operation-boundary contract](../../design/operation-boundaries/plans/scoped/architecture.md).

## Entity ownership

Publication lease records complete token owners for a short snapshot. Read access takes a shared snapshot and rejects publication. Non-dry-run write access takes an exclusive snapshot.

Dry-run chooses whether a write plan is published. It does not change the access class. A dry-run preview uses a shared snapshot and never authorizes publication.

The first owner is published by a temporary directory, fsync, and atomic rename. A later shared owner joins by an atomic hard link of its complete token file. A single-owner record from the previous format is treated as exclusive. Constructing LocalRepository does not hold a command-long writer lock.

Runner lease, run state, and evidence have their own owners. Recover does not delete them. A journal owns one prepared change set. An unfinished multi-file journal still blocks an ordinary snapshot.

## Data flow

A shared joiner re-reads the complete owner set before any protected read. The read is authorized only when its own token is present and every owner is shared for the same worktree. If the last reader has left and a writer has replaced the directory, the joiner removes its own token and reports Busy.

A writer release checks and deletes only its own owner. A legitimate shared join record that has not passed admission does not authorize a read. It also does not block that release. Unknown files, another exclusive token, or an identity change stay in place and reject the operation.

Owner-format validity and critical-section admission are separate judgments. The same worktree and host, at most one exclusive owner, and any number of shared owners form a legitimate join transient. Several exclusive owners, an unknown file, or an identity mismatch do not.

When every owner is confirmed ESRCH, recover reclaims that transient one token at a time. Any live owner stays. Host mismatch, EPERM, PID reuse, and an unknown owner also stay. Recovery does not infer death from age.

Failed fsync or failed verification after a join removes that exact token. A failed cleanup keeps the named error and the scene. Recovery never recursively deletes the fixed lease directory.

Recover first records and reclaims observed dead publication tokens. It then selects the single journal under exclusive protection. Later engine stages do not reclaim again.

A new owner, even if it subsequently dies, makes this call Busy; a later explicit recovery records its reclamation. Ordinary or Trace recovery takes a fresh short exclusive snapshot, followed by final journal and runner verification.

That check uses the worktree-private coordination path directly. It does not require a configuration file to remain after init rollback. A concurrent publication can make the final check Busy. The earlier journal result is not a completed recovery in that case.

## Invariants

- Read and write access stay separate from dry-run. CLI queries declare read. CLI actions and Web use the same action classification. External execution, recovery, cache rebuild, cache clear, and document writes use write.
- Persistent cache handles close before the snapshot ends. A cache update during a read is not a reason to take the exclusive publication lock. An unsafe cache reads the source.
- A reader that passes verification after the writer has released may start. The directory then has no writer. Its nonempty token prevents a later exclusive rename.
- Partial document parsing still uses the publication lease. It does not bypass recovery.
- The unified recovery entry keeps prepared and committed scenes. It does not gain cleanup authority by reinterpreting an engine phase.
- Blocked means this operation cannot restore full write capability. It does not add a claim that an owner file is corrupt or that evidence is invalid.
- Reclaiming a dead publication token proves ESRCH for that token. It does not identify an unreproduced macOS scene.

## Errors

A writer that replaces the lease directory makes the joiner Busy. Multiple journals are a named conflict. That conflict is reported before the runner result, and the scene stays. Content that matches neither the preimage nor the planned digest stays for a person to judge.

The recovery result keeps operation, the journal outcome, and changedPaths. It also adds coordination. Publication lists reclaimedTokens. Runner status is absent, running, or blocked. Blocked carries a named reason.

With no transaction, absent or healthy running may return clean. An uncertain runner returns blocked and keeps the journal result actually produced.

If the first exclusive check already finds runner blocked, journal recovery does not start. Journal status is pending when a journal exists and clean when it does not. Changed paths is empty.

If the runner becomes blocked after journal handling, the completed journal status remains. The overall status becomes blocked. The CLI fails on blocked. Web and action return the same status fields.

## Identity and reuse

Each token is exact. Release and dead-owner recovery delete only that token. A new writer that arrives during recovery is not deleted. Independent worktrees do not share a lease. Only the current coordination protocol is supported. Prior lock formats are not migrated, and mixed executable versions are not coordinated.
