---
format: concord.document/v1
id: recover-local-state
title: 保护并恢复本地状态
createdAt: 2026-09-13T11:00:36.514Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 保护并恢复本地状态

## 用户目标

在多人或多个 Agent 并行编辑的仓库里，维护者要确认 Concord 的写入不会越出 worktree，不会覆盖别人的改动，中断后也不会留下半套文件。

## 起始状态

- 项目已经初始化。
- 某次 Concord 写入可能被中断，例如进程被杀或机器断电。

## 完整路径

1. 运行任意读写命令。如果上一次写入没有完成，命令会拒绝执行并要求恢复。 {#detect}

2. 恢复。 {#recover}

   ```sh
   concord --json recover
   ```

   没有未完成写入时：

   ```json
   {"operation":"recover","status":"clean","changedPaths":[],"journalStatus":"clean","coordination":{"publication":{"reclaimedTokens":[]},"runner":{"status":"absent"}}}
   ```

   有未完成写入时，`changedPaths` 列出被完成或回退的文件，`journalStatus` 报告处理结果，`coordination.publication.reclaimedTokens` 列出回收的写入占用，`coordination.runner.status` 报告测试进程的清理状态。

3. 恢复被拒绝时，查看冲突文件，人工决定保留哪一份内容，再重新运行 `recover`。 {#resolve-conflict}

## 结果

恢复只在每个文件都处于两种已知状态之一时执行：仍是写入前的内容，或已是计划写入的内容。它把整组文件一起完成或一起回退，关系与历史随之恢复。

| 情况 | 结果 |
| --- | --- |
| 文件既不是写入前的内容也不是计划内容 | 拒绝恢复，保留外部编辑 |
| 测试进程的清理状态未知 | 保留恢复记录，返回 blocked，CLI 退出 1。Web 与 action 返回同一个阻塞结果，只读查询仍可进行 |
| 另一个写入者正持有项目 | 最终核验返回 Busy，不报告恢复完成 |
| 回退的是 `init` | 最终核验不要求配置文件仍然存在 |

没有恢复记录不代表测试进程已经清理，所以 `runner.status` 单独报告。

## 写入保护

- 路径穿越、绝对路径、symlink 逃逸和并发写入都被拒绝。
- `--dry-run` 执行同样的规划与校验，不写文档、恢复记录或缓存。

## 契约来源

- 恢复记录、发布与所有权：[协调架构](../../portable-coordination/architecture.md)
- 写入管线：[架构](../architecture.md#写入管线)
