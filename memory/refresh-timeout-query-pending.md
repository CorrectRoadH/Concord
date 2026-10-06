---
format: concord.document/v1
id: refresh-timeout-query-pending
title: 大仓库后台刷新超时导致诊断查询持续 QueryPending
createdAt: 2026-10-06T03:44:03.044Z
kind: memory
memoryKind: problem
state: open
epoch: 0
evidenceRequirement: command
promotions: []
history: []
---

# 大仓库后台刷新超时导致诊断查询持续 QueryPending

## 现象

2026-10-06 在已接入的 rpg-game 仓库（Git 跟踪 4727 个文件，其中 docs 1096 个；工作区有 84 处未提交改动）执行 `concord trace gaps --json`（Homebrew 安装的 0.11.4），每次都立即返回：

```json
{"ok":false,"error":"QueryPending","details":{"refresh":{"code":"QueryRefreshFailed","message":"Diagnostic scan failed or timed out"}}}
```

前台只读缓存路径没有阻塞，问题在于从未发布过投影。

## 复现与测量

在该仓库手动执行后台刷新进程使用的同一条扫描 `concord --json --fresh --dry-run trace gaps`：wall 177.7s，user 82.5s，system 100.4s，最终 `PreimageChanged`（`docs/feature/npc/视觉/本人观察表达.md` 在扫描期间被修改）。

## 原因

1. `src/query-refresh-worker.ts` 的刷新上限为 120s，扫描超过该时间后子进程被终止。stdout 与 stderr 为空，只记录泛化的 `Diagnostic scan failed or timed out`，没有超时或耗时信息。
2. 即使不受上限限制，扫描窗口长达约 3 分钟，持续编辑的工作区几乎必然触发来源变化（`PreimageChanged` / `SourceChanged`），结果被拒绝发布。
3. 刷新失败只写 `error`，不写 `record`；没有上一代投影的仓库因此一直返回 QueryPending，后续每次调用又会排一次注定失败的扫描。

system 时间占比约 55%，推测文件系统调用次数是主要成本，尚未做 profile 确认。

## 后续

- 用 `pnpm profile refresh --consumer scale` 或冻结的 rpg-game 副本定位耗时来源（测量路径见 docs/engineering/concord-self-hosting/performance.md）。
- 用 `pnpm bench query --consumer scale` 检查刷新上限（契约见 query-asynchronous-projections 的“刷新上限”表）。
- 超时需要具名错误并记录耗时。
