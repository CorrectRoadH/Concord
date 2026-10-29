---
format: concord.document/v1
id: portable-coordination
title: Portable coordination with short publication leases
createdAt: 2026-09-22T00:05:16.786Z
kind: feature
---



# Portable coordination with short publication leases

Concord coordinates local Markdown publication through Node filesystem APIs. HawDB remains a disposable parsing cache; it does not own publication leases, source transactions or journal recovery.

The [architecture](architecture.md) defines access modes, reader admission and recovery results.

## User goals

- Run without flock, diskutil, plutil or a stat subprocess.
- Prepare independent changes without holding a command-long writer lock.
- Serialize only coherent snapshot and publication sections, with one active file transaction.
- Preserve complete preimage recovery and reject changed planning dependencies.
- Keep long command execution separate from document publication ownership.

## Scope

Linux and macOS local worktrees on one host and in one PID namespace. Only the current coordination protocol is supported; lock formats are not migrated and mixed executable versions are not coordinated.

Git remains required for repository identity. Network and multi-host coordination are outside the guarantee, and no storage device is certified. Platform support is owned by [cross-platform release](../cross-platform-release/README.md).

## Contract

[Coordinate local publications](use-case/coordinate-local-publications.md) defines the entry, failure and recovery behavior. Node file leases replace external lock programs so the packed CLI stays portable ([decision rationale](../../design/portable-publication/DECISION.md)).

## Constitution

- [C-001](../../constitution.md#c-001)
- [C-002](../../constitution.md#c-002)
- [C-003](../../constitution.md#c-003)
- [C-004](../../constitution.md#c-004)
- [C-005](../../constitution.md#c-005)
- [C-006](../../constitution.md#c-006)
- [C-007](../../constitution.md#c-007)
- [C-013](../../constitution.md#c-013)
