---
format: concord.document/v1
id: coordinate-local-publications
title: Coordinate local edits without external lock helpers
createdAt: 2026-09-22T00:05:17.678Z
kind: use-case
feature: docs/feature/portable-coordination/README.md
---

# Coordinate local edits without external lock helpers

## User goal

Read and prepare local changes without installing an external lock or disk-inspection program, then commit a complete validated change with an explainable recovery path.

## Complete path

1. Open the worktree and validate current project configuration in a short snapshot section.
2. Prepare the operation, remembering its source bytes, missing reads and directory membership.
3. Acquire the common publication lease; reject pending journals, changed dependencies or target preimages before any publication.
4. Persist the prepared journal, apply the complete change set, mark it committed and remove the completed journal.
5. Release ownership after the critical section. Long test execution uses separate execution ownership and before/after evidence verification.
6. After interruption, recover only a same-host, provably dead publication owner and a journal whose paths still match their before or planned bytes. Runner cleanup must be confirmed separately; parent death alone cannot release runner ownership. Unknown metadata and edits remain untouched.

## Acceptance

- Built CLI works without flock, diskutil, plutil or stat executables.
- Opening two repositories does not grant either a command-long writer lock.
- Competing commit and snapshot sections exclude each other; independent worktrees do not.
- A change in an authorization dependency, missing file or scanned directory invalidates the plan even if the write target is unchanged.
- Concurrent dead-owner recovery and a newly arriving writer cannot delete the new owner.
- Snapshot consumers never return a successfully validated mixed publication; failed or interrupted publication preserves recoverable state.
- Test execution does not block unrelated document publication, and changed inputs or uncertain cleanup cannot produce green evidence.
- Cache deletion affects only disposable cache state.

## Compatibility

Only the current coordination protocol is supported. This release does not migrate prior lock formats or coordinate with old executables. Existing document and evidence source files remain their own facts; do not delete journals or evidence as though they were cache.
