---
type: decision
status: current
relations:
  - role: amends
    target: docs/constitution.md
---

# 按 HawDB 一个目录一个长期持有者的规定，由每个 worktree 的工作区服务持有持久缓存

宪法修订，日期 2026-10-30。

## 理由

按 HawDB 一个目录一个长期持有者的规定，由每个 worktree 的工作区服务持有持久缓存

## 影响

持久句柄不再随来源快照结束；写入、发布、恢复与证据仍不依赖缓存所有者

## 来源

- `docs/design/cli-hot-path/DECISION.md`
- `docs/feature/local-data-engine/architecture.md`
