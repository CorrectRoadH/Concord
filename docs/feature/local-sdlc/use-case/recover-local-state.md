# 保护并恢复本地状态

## 用户目标

在多人或多个 Agent 并行编辑的仓库里，维护者要确认 Concord 的写入不会越出项目目录，不会覆盖别人的改动，中断后也不会留下半套文件或锁死仓库。

## 起始状态

- 项目已经初始化。
- 某次 Concord 写入可能被中断，例如服务进程被杀或机器断电。

## 完整路径

1. 运行任意命令。 {#detect}

   命令连接或启动工作区服务。新服务在应答任何请求前先处理上一次遗留的 `journal.json`，所以命令看到的总是已恢复的文件，不会被要求先手动恢复。

2. 需要确认时显式恢复。 {#recover}

   ```sh
   concord --json recover
   ```

   没有未完成写入时：

   ```json
   {"operation":"recover","status":"clean","changedPaths":[],"journalStatus":"clean","warnings":[],"observationSlot":{"status":"absent"}}
   ```

   有未完成写入时，`changedPaths` 列出被完成或回退的文件，`journalStatus` 报告 `completed`、`rolledBack` 或 `discarded`，`observationSlot.status` 报告外部观察任务槽位的清理状态。

3. `journalStatus` 为 `discarded` 时，查看 `warnings` 列出的文件。 {#resolve-conflict}

   这些文件在中断后被外部编辑过，Concord 保留了磁盘上的内容。确认内容符合预期后照常继续；需要时重新运行原来的写入命令。

4. 外部观察任务槽位被已经不存在的进程占着时，确认后释放。 {#release-observation-slot}

   `test discover`、`code analyze` 等外部观察同一时刻只允许一个，占用者被强杀后槽位不会自己释放：
   Concord 无法证明它启动的外部观察子进程也已经结束。此后这些命令返回 `RepositoryBusy`，`recover` 报告：

   ```json
   {"operation":"recover","status":"blocked","observationSlot":{"status":"blocked","token":"33c6d404-5f1f-4178-9e20-62489a63c4fc","host":"studio","pid":2976895,"ownerAlive":false,"startedAt":"2026-11-13T10:35:02Z","release":"concord recover --release-observation-slot 33c6d404-5f1f-4178-9e20-62489a63c4fc"}}
   ```

   `RepositoryBusy` 的错误文本带同样的 token、pid、`ownerAlive` 与 `release` 命令，不需要再运行一次 `recover` 才知道怎么办。
   确认没有遗留的收集或分析进程后执行给出的命令：

   ```sh
   concord recover --release-observation-slot 33c6d404-5f1f-4178-9e20-62489a63c4fc
   ```

   Concord 删除该槽位的占用与运行状态，回收它登记的收集产物目录，输出 `observationSlot.status: "released"`。给出 token 就是用户对“子进程已清理”的确认。

## 结果

恢复把整组文件一起完成或一起回退：每个文件都已是计划内容时完成，否则回到写入前的内容。

| 情况 | 结果 |
| --- | --- |
| 文件既不是写入前的内容也不是计划内容 | 保留磁盘内容，删除 journal，`journalStatus` 为 `discarded`，`warnings` 列出路径 |
| 外部观察任务槽位清理状态未知 | `observationSlot.status` 为 `blocked`，CLI 退出 1；Web 与 action 返回同一结果，文档读写照常 |
| `--release-observation-slot` 的占用者进程仍然存活 | `ObservationSlotActive`，不释放；等它结束或先终止它 |
| `--release-observation-slot` 的 token 与当前占用不符，或占用登记在另一台主机上 | `ObservationSlotMismatch`，不释放；错误给出当前占用的 token 与主机 |
| 另一个写入正在提交 | 在写互斥后排队，最多等待 3 秒，超时返回 `RepositoryBusy` |
| 回退的是 `init` | 不要求配置文件仍然存在 |

## 写入保护

人和 agent 同时编辑同一个仓库时，Concord 的写入不能破坏别人的工作。

- 每次写入都校验目标路径与计划依赖文件的摘要。路径穿越、绝对路径与 symlink 逃逸被拒绝；依赖已变的计划以 `SourceChanged` 拒绝。
- 外部编辑永远优先于 Concord 未完成的写入。
- `--dry-run` 执行同样的规划与校验，不写文档、journal 或缓存。

## Spec 来源

- journal、写互斥与恢复规则：[协调架构](../../portable-coordination/architecture.md)
- 写入管线：[架构](../architecture.md#写入管线)
