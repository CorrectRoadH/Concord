

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

## 依据的品味与底线

- [一件事只写一次，其余推导](../../constitution.md#c-019)
- [独立、本地、可安装](../../constitution.md#c-002)
- [写入遵守范围和恢复 Spec](../../constitution.md#c-003)
- [只声称证明过的](../../constitution.md#c-021)
- [维护代码采用严格 TypeScript 与 Effect](../../constitution.md#c-005)
- [用产品自身管理和验收开发](../../constitution.md#c-006)
- [尊重协作与外部操作授权](../../constitution.md#c-007)
