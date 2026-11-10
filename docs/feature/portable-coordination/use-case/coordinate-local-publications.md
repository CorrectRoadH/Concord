# 协调本地写入与恢复

## 用户目标

维护者或 agent 在没有外部锁程序与磁盘检查程序的机器上读取并提交本地修改，不覆盖别人同时做的修改；进程被打断或文件被外部编辑后，仓库仍然可以继续读写。

## 起始状态

- 项目已初始化；`PATH` 中没有 flock、diskutil、plutil 与 stat。
- 同一项目目录里还有另一个命令或 agent 在写文档。

## 完整路径

1. 读取文档。 {#read}

   ```sh
   concord list memory
   ```

   ```text
   list
   documents: 
     memory/coordination-notes.md — coordination-notes
   ```

   读取访问工作区服务的当前工作区图，不进入[写互斥](../../../concepts.md#write-exclusion)，另一个写入正在提交时照常返回。返回的结果对应一个[发布修订号](../concepts.md#publication-revision)；历史诊断查询遵守[异步投影](../../local-data-engine/use-case/query-asynchronous-projections.md)。

2. 提交写入时遇到另一个写入。 {#contention}

   ```sh
   concord new memory busy-note
   ```

   ```text
   ok: false
   error: SourceChanged
   message: memory/README.md changed after the plan was prepared; rerun the command.
   ```

   写入先基于读到的内容准备计划，提交时在服务内排队进入写互斥。轮到它时，计划依赖的文件摘要全部未变就写 journal 并发布；任一依赖已被先到者或外部编辑改变，就以 `SourceChanged` 拒绝，不写任何文件。重新运行命令即基于新内容重新规划。排队超过 3 秒返回 `RepositoryBusy`，不撤销正在提交的写入。

3. 服务进程在写入途中被杀后继续工作。 {#server-killed}

   ```sh
   concord new memory after-crash
   ```

   ```text
   Applied new:
     memory/after-crash.md

   Next: edit the pages, then run concord check.
   ```

   下一次命令自动启动新的工作区服务。新服务取得 `server/lock` 后、开始应答请求前，先按[恢复规则](../architecture.md#恢复规则)处理遗留的 `journal.json`，因此这条命令看到的是已恢复的文件。写互斥只在内存中，进程退出即释放，不需要回收持有记录。

4. 想确认协调状态时，运行恢复。 {#recover}

   ```sh
   concord recover
   ```

   ```text
   Recovery: clean
   Journal: completed
   Test slot: absent
   ```

   再运行一次 `concord recover --json`，已没有遗留 journal：

   ```json
   {"operation":"recover","status":"clean","changedPaths":[],"journalStatus":"clean","warnings":[],"testSlot":{"status":"absent"}}
   ```

   `recover` 经由工作区服务在写互斥下执行与服务启动时相同的恢复。目标文件已被外部编辑时，`journalStatus` 为 `discarded`，`warnings` 列出保留了外部内容的路径。

## 结果

| 情形 | 结果 |
| --- | --- |
| 打包后的 CLI，`PATH` 中没有 flock、diskutil、plutil 或 stat | 正常工作 |
| 两个写入同时提交，目标与依赖互不相关 | 依次发布，都成功 |
| 两个写入同时提交，后到者的依赖被先到者改变 | 后到者返回 `SourceChanged`，不写文件 |
| 排队等待写互斥超过 3 秒 | 返回 `RepositoryBusy`，正在提交的写入不受影响 |
| 读取与写入并发 | 读取不等待写入；返回的结果对应一个完整的发布修订号 |
| 不同项目目录，包括 linked worktree | 各自的服务与写互斥，互不影响 |
| 服务在发布途中被 `SIGKILL` | 下一次启动的服务先恢复再应答；目标全部是计划内容时完成，否则回滚到前像 |
| 遗留 journal 的目标文件已被外部编辑 | 保留磁盘内容，删除 journal，`journalStatus` 为 `discarded` 并在 `warnings` 报告路径；后续读写照常 |
| `journal.json` 无法解码 | 按陈旧记录删除并在 `warnings` 报告，不阻断读写 |
| `recover` 的输出 | `operation`、`status`、`journalStatus`（`clean`、`completed`、`rolledBack` 或 `discarded`）、`changedPaths`、`warnings` 与 `testSlot.status` |
| 测试任务槽位清理不确定 | `testSlot.status` 为 `blocked` 并带具名原因；新的测试任务被拒绝，文档读写照常 |
| 测试执行期间发布无关文档 | 不被阻塞；输入变化或清理不确定时不能产生通过的证据 |
| 删除缓存 | 只影响可丢弃的缓存状态，不删除 journal |
| 不安全路径 | 按[路径安全](../../local-sdlc/architecture.md#路径安全)拒绝 |

访问模式、恢复规则与数据流见[架构](../architecture.md)。
