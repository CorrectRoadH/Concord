---
format: concord.document/v1
id: coordinate-local-publications
title: Coordinate local edits without external lock helpers
createdAt: 2026-09-22T00:05:17.678Z
kind: use-case
feature: docs/feature/portable-coordination/README.md
---


# Coordinate local edits without external lock programs

## User goal

Read and prepare local changes without external lock or disk-inspection programs. Commit a complete validated change with an explainable recovery path.

## Complete path

1. Open the worktree and validate configuration and paths.
2. Read source dependencies without publication ownership. Record preimages, missing paths, directory membership and publication revision.
3. Verify observations before returning a current result. Historical diagnostic queries follow the [asynchronous projection contract](../../local-data-engine/use-case/query-asynchronous-projections.md).
4. Plan ordinary document changes without an exclusive lease. Acquire exclusive ownership for commit, then validate all dependencies and preimages before writing the journal.
5. Publish the complete planned change, preserve recovery state on interruption, and release the exact publication token.
6. Recovery verifies journal and runner state under exclusive protection. Unknown metadata and external edits remain untouched.

Admission, access and recovery fields are specified in [Architecture](../architecture.md).

## Contention

Ordinary repository admission may reclaim observed tokens when every owner is in this worktree and host and is confirmed ESRCH. It retries once. This does not recover journals or reclaim runner ownership.

Explicit snapshot and recovery acquisition waits asynchronously for up to three seconds. Ordinary synchronous commit reports contention immediately. Later attempts cannot reclaim new owners. A timeout includes PID, host and mode; it does not revoke ownership or replay a mutation.

Synchronous APIs report contention immediately. Explicit recovery retains its token receipt and does not automatically reclaim a newly arriving owner.

## Acceptance

- Built CLI works without flock, diskutil, plutil or stat executables.
- Opening two repositories does not grant either a command-long writer lock.
- Competing commits exclude each other. Source readers do not block writers; drift rejects the current result. Independent worktrees do not share ownership.
- A complete publication between source observations changes the revision, including an A→B→A edit.
- Live or dead publication tokens alone do not block ordinary source reads; unfinished journals still do.
- A change in an authorization dependency, missing file or scanned directory invalidates the plan even if the write target is unchanged.
- Concurrent dead-owner recovery and a newly arriving writer cannot delete the new owner.
- Recover returns operation, the journal outcome, changedPaths, and coordination. Publication lists reclaimedTokens. Runner status is absent, running, or blocked. Blocked carries a named reason and fails the CLI.
- If the first exclusive check finds runner blocked, journal recovery does not start. Journal status is pending when a journal exists and clean when it does not. Changed paths is empty.
- After journal handling, the final exclusive check can be Busy. Busy does not turn the earlier journal result into a completed recovery. If the runner becomes blocked after that handling, `journalStatus` keeps the journal result and status is blocked.
- Multiple journals are a named conflict, reported before the runner result. recover does not delete `runner.lease`, run state, evidence, or unknown files.
- Test execution does not block unrelated document publication, and changed inputs or uncertain cleanup cannot produce green evidence.
- Cache deletion affects only disposable cache state.

## Compatibility

Only the current coordination protocol is supported; lock formats are not migrated and other executable versions are not coordinated. A legitimate join transient belongs to this protocol and is reclaimed only after every owner is ESRCH.

Existing document and evidence source files remain their own facts. Do not delete journals or evidence as though they were cache. Reclaiming a dead publication token proves ESRCH for that token. It does not identify an unreproduced macOS scene.
