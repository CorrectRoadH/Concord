---
format: concord.document/v1
id: portable-coordination
title: Portable coordination with short publication leases
createdAt: 2026-09-22T00:05:16.786Z
kind: feature
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-002
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-005
  - docs/constitution.md#c-006
  - docs/constitution.md#c-007
---

# Portable coordination with short publication leases

Concord coordinates local Markdown publication through Node filesystem APIs. SQLite remains a disposable parsing cache; it does not own locks, transactions or recovery.

## User goals

- Run without flock, diskutil, plutil or a stat subprocess.
- Prepare independent changes without holding a command-long writer lock.
- Serialize only coherent snapshot and publication sections, with one active file transaction.
- Preserve complete preimage recovery and reject changed planning dependencies.
- Keep long command execution separate from document publication ownership.

## Scope

Linux and macOS local worktrees on one host and in one PID namespace. No legacy lock migration or mixed-version coordination is provided. Git remains required for repository identity. Network and multi-host coordination are outside the guarantee; removing disk-name probing does not certify every storage device. Windows process execution is outside this release.

## Contract

[Coordinate local publications](use-case/coordinate-local-publications.md) defines the entry, failure and recovery behavior. [Portable publication design](../../design/portable-publication/README.md) compares the mechanisms.
