# Portable runtime and release coordination

## Problem

Remove the external flock program by replacing it with a Node filesystem lock shared by Linux and macOS.

## Core Mental Model

An atomic directory or file would persist owner PID/token state and serialize repository operations. Explicit recovery would clear only a provably dead same-host owner.

## Scope

This candidate requires a new lock format, a migration from live flock inodes, new concurrent recovery semantics and a decision about serializing current shared readers.

## Limits

Use one row per Limit, with its exact ID and actual heading anchor. Status: satisfied, not-satisfied, pending (满足、不满足、待验证). Do not omit failed or unverified constraints.

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-existing-lock-and-recovery-evidence-remains-valid) | not-satisfied | A new persistent lock cannot exclude an already-open old flock inode without offline migration. | Independent design challenge identified the split-generation race. |
| [L2](../../LIMITS.md#l2-unsupported-storage-remains-rejected) | satisfied | Filesystem admission can be independent of lock choice. | Same APFS boundary as the selected plan. |
| [L3](../../LIMITS.md#l3-cleanup-uncertainty-cannot-become-success) | satisfied | Process cleanup is orthogonal. | Same process-group design as selected plan. |
| [L4](../../LIMITS.md#l4-publication-follows-verification) | satisfied | Release workflow is orthogonal. | Same publication state machine. |

## Goals

Use one row per Goal. Status: satisfied, partial, not-satisfied, pending (满足、部分满足、不满足、待验证). Structure validation does not prove real-world compliance.

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-preserve-safe-repository-coordination) | not-satisfied | Requires an unimplemented offline migration and changes reader contention. | Recovery and split-generation protocol are unresolved. |
| [G2](../../GOALS.md#g2-verify-one-package-across-supported-platforms) | satisfied | Could run on both platforms after migration. | No advantage over retaining flock for package verification. |
| [G3](../../GOALS.md#g3-automate-tag-to-channel-synchronization) | satisfied | Release workflow is independent. | Same workflow remains possible. |

## Entry Points

- [Architecture](architecture.md)
- [Lifecycle](lifecycle.md)
