# Portable runtime and release coordination

## Problem

Add macOS and automated releases without migrating the repository's coordination and recovery protocol.

## Core Mental Model

`flock` remains the cross-process lease. Linux uses its system command; Homebrew macOS supplies the keg-only util-linux binary through the Concord launcher PATH. Platform-specific code only establishes whether storage and process-group observations meet the existing safety contract. Source and tap workflows publish their own identities after verification.

## Scope

Supports Linux and Apple Silicon macOS 14/15 APFS. It keeps an external flock prerequisite and deliberately excludes a lock migration, Intel macOS, HFS, network filesystems and Windows.

## Limits

Use one row per Limit, with its exact ID and actual heading anchor. Status: satisfied, not-satisfied, pending (满足、不满足、待验证). Do not omit failed or unverified constraints.

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-existing-lock-and-recovery-evidence-remains-valid) | satisfied | Keep the current descriptor-backed protocol and formats. | Existing Linux contention/recovery suites remain authoritative. |
| [L2](../../LIMITS.md#l2-unsupported-storage-remains-rejected) | satisfied | Darwin performs strict APFS and exact-path checks. | Candidate CI includes APFS alias and unsupported-host tests. |
| [L3](../../LIMITS.md#l3-cleanup-uncertainty-cannot-become-success) | satisfied | ESRCH-only group absence and bounded TERM/KILL observation. | Cleanup result remains part of green evidence gate. |
| [L4](../../LIMITS.md#l4-publication-follows-verification) | satisfied | Source and tap each verify immutable inputs before their publication step. | Workflows use matrix needs, digest checks and idempotent identity guards. |

## Goals

Use one row per Goal. Status: satisfied, partial, not-satisfied, pending (满足、部分满足、不满足、待验证). Structure validation does not prove real-world compliance.

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-preserve-safe-repository-coordination) | satisfied | No lock or journal protocol change. | Same protocol and existing tests. |
| [G2](../../GOALS.md#g2-verify-one-package-across-supported-platforms) | satisfied | Pack once and fan out the same artifact digest. | Required release matrix. |
| [G3](../../GOALS.md#g3-automate-tag-to-channel-synchronization) | satisfied | Source tag Release plus public tap discovery and idempotent update. | Workflow identity and retry guards. |

## Entry Points

- [Architecture](architecture.md)
- [Lifecycle](lifecycle.md)
