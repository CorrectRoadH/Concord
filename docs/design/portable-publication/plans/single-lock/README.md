# One portable publication lease

Prepare a unique temporary directory containing a complete token-named owner file, then atomically rename it onto the nonempty lease directory. Competing claims cannot replace an occupied directory. Release and explicit dead-owner recovery unlink only the observed token; never recursively delete the live lease path. Snapshot and publication sections use this same primitive. No age-based stealing.

## Goals

| Requirement | Status | Mechanism or gap | Evidence |
|---|---|---|---|
| [G1](../../GOALS.md#g1-portable-runtime) | satisfied | Node file APIs and short critical sections. | Independent Astra design challenge passed with the contract below; implementation verification is required before release. |
| [G2](../../GOALS.md#g2-short-ownership) | satisfied | Node file APIs and short critical sections. | Independent Astra design challenge passed with the contract below; implementation verification is required before release. |
| [G3](../../GOALS.md#g3-simple-coordination) | satisfied | Node file APIs and short critical sections. | Independent Astra design challenge passed with the contract below; implementation verification is required before release. |

## Limits

| Requirement | Status | Mechanism or gap | Evidence |
|---|---|---|---|
| [L1](../../LIMITS.md#l1-preserve-authorization) | satisfied | Must implement the stated snapshot, token and execution constraints. | Independent Astra design challenge passed with the contract below; implementation verification is required before release. |
| [L2](../../LIMITS.md#l2-recover-safely) | satisfied | Must implement the stated snapshot, token and execution constraints. | Independent Astra design challenge passed with the contract below; implementation verification is required before release. |
| [L3](../../LIMITS.md#l3-preserve-execution-evidence) | satisfied | Must implement the stated snapshot, token and execution constraints. | Independent Astra design challenge passed with the contract below; implementation verification is required before release. |
| [L4](../../LIMITS.md#l4-no-new-fact-store) | satisfied | Must implement the stated snapshot, token and execution constraints. | Independent Astra design challenge passed with the contract below; implementation verification is required before release. |

## Adopted contract

- A complete token owner is fsynced in a unique same-parent temporary directory before rename publishes a nonempty lease. Fsync the parent before protected work. Every claim has a new token. Unknown metadata, symlinks, extra files, failed durability or identity uncertainty fail closed.
- Release and dead-owner recovery unlink only the observed token file. Only the successful unlink may attempt nonrecursive rmdir; ENOTEMPTY preserves a new owner. Never recursively remove the fixed lease directory. Close is idempotent. Only same-host ESRCH permits document-owner recovery, followed by a new normal claim before journal work.
- LocalRepository exposes short synchronous snapshot sections. Constructing a repository does not retain a lease. CLI and View synchronous planning/reading run in snapshots; interaction, network and test execution do not. Separate publication validates frozen first reads, missing reads, directory membership and types, configuration, target preimages and permissions. Fixed-evidence validation and its Memory write share one snapshot.
- Trace uses the same publication owner. Recovery selects the sole active journal while locked; multiple journals are a conflict. Cache operations use a snapshot, and SQLite remains disposable cache only.
- CLI and Web share a separate runner lease. Before process start, record a durable token-bound running state under document ownership. Publication is permitted only for an alive, same-host running owner and first persists an irreversible invalidated bit for that run. Missing, corrupt, finalizing or quarantined state blocks publication. Before final result handling enter finalizing; cleanup failure persists quarantined state. Dead runner parents are never automatically reclaimed as though their children had exited.
- A fresh final snapshot checks candidate/config/definition/contract/epoch, invalidation and confirmed cleanup before storing evidence. Only confirmed cleanup and completed evidence handling release runner ownership. A publication that changes A to B and back to A still invalidates the run. This is a cooperative-writer guarantee, not observation of every transient external editor change.
- No old lock migration, mixed-version compatibility, database coordination or shared-reader protocol is added. Short snapshots serialize; preparation outside them can run concurrently. Linux/macOS local filesystem and one host/PID namespace are the supported coordination boundary.

## Acceptance

Real process contention, competing dead-owner recovery, interrupted claims/publication, stale planning dependencies, runner quarantine and A-to-B-to-A invalidation must pass. The release gates the packed CLI on Linux and macOS. These are acceptance obligations, not claims that the design review executed tests.
