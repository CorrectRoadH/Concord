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

1. Open the worktree and validate project configuration in a short snapshot. Queries declare read access and take a shared snapshot. Actual writes, external execution, recovery, and cache rebuild or clear use exclusive ownership. A dry-run preview keeps its write access classification but uses a shared snapshot and never authorizes publication.
2. Prepare the operation from the owners that command depends on, remembering its source bytes, missing reads and directory membership.
3. Acquire the publication lease for that access. A shared joiner re-reads the full owner set and starts the protected read only when its own token is present and every owner is shared for the same worktree. Otherwise it removes its token and reports Busy.
4. Reject pending journals, changed dependencies or target preimages before any publication. An unfinished multi-file journal still blocks an ordinary snapshot.
5. Persist the prepared journal, apply the complete change set, mark it committed and remove the completed journal. A dry-run write stops before this publication.
6. Release ownership after the critical section by deleting only the caller's own owner. A shared join record that has not passed admission does not authorize a read and does not block that release. Long test execution uses separate execution ownership and before/after evidence verification.
7. After interruption, record and reclaim dead publication tokens. This includes a same-worktree, same-host join transient of at most one exclusive owner plus shared owners when every owner is ESRCH. Select the journal under an exclusive snapshot. A live owner, another exclusive owner, an unknown file, a host mismatch, EPERM, PID reuse, or an unknown owner stays in place.
8. Recover a journal only when each path still matches its before or planned bytes. Runner cleanup is confirmed separately. Parent death alone cannot release runner ownership.
9. After ordinary or Trace handling, take a fresh exclusive snapshot and verify the current journal and runner. That check uses the worktree-private coordination path. It does not require a configuration file left by a rolled-back init. A concurrent publication can make it Busy. Unknown metadata and edits remain untouched.

Admission, access, and recovery fields are specified in [Architecture](../architecture.md).

## Acceptance

- Built CLI works without flock, diskutil, plutil or stat executables.
- Opening two repositories does not grant either a command-long writer lock.
- Competing commit and snapshot sections exclude each other; independent worktrees do not.
- Independent read snapshots can run concurrently, including from separate processes. An exclusive publication acquires ownership only after every admitted shared owner exits.
- A shared joiner reads protected data only after its token is present and every owner is shared for the same worktree. A replaced directory makes that joiner remove its token and report Busy.
- A writer release deletes only its own owner. A shared join record that has not passed admission does not authorize a read and does not block that release.
- Same worktree, same host, at most one exclusive owner plus shared owners is a legitimate join transient. When every owner is ESRCH, recover reclaims those tokens one by one. A live owner stays.
- A change in an authorization dependency, missing file or scanned directory invalidates the plan even if the write target is unchanged.
- Concurrent dead-owner recovery and a newly arriving writer cannot delete the new owner.
- Snapshot consumers return a validated read only after admission succeeds. Failed or interrupted publication preserves recoverable state.
- Recover returns operation, the journal outcome, changedPaths, and coordination. Publication lists reclaimedTokens. Runner status is absent, running, or blocked. Blocked carries a named reason and fails the CLI.
- If the first exclusive check finds runner blocked, journal recovery does not start. Journal status is pending when a journal exists and clean when it does not. Changed paths is empty.
- After journal handling, the final exclusive check can be Busy. Busy does not turn the earlier journal result into a completed recovery. If the runner becomes blocked after that handling, `journalStatus` keeps the journal result and status is blocked.
- Multiple journals are a named conflict, reported before the runner result. recover does not delete `runner.lease`, run state, evidence, or unknown files.
- Test execution does not block unrelated document publication, and changed inputs or uncertain cleanup cannot produce green evidence.
- Cache deletion affects only disposable cache state.

## Compatibility

Only the current coordination protocol is supported. This release does not migrate prior lock formats or coordinate with old executables. A legitimate join transient belongs to this protocol and is reclaimed only after every owner is ESRCH.

Existing document and evidence source files remain their own facts. Do not delete journals or evidence as though they were cache. Reclaiming a dead publication token proves ESRCH for that token. It does not identify an unreproduced macOS scene.
