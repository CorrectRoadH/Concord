# 不依赖外部锁程序协调本地写入

## 用户目标

维护者或 agent 在没有外部锁程序与磁盘检查程序的机器上读取并准备本地修改，提交经过完整校验的修改；被打断时能说清楚怎样恢复。

## 起始状态

- 项目已初始化；`PATH` 中没有 flock、diskutil、plutil 与 stat。
- 同一 worktree 里还有另一个命令或 agent 在写文档。

## 完整路径

1. 读取文档。 {#read}

   ```sh
   concord list memory
   ```

   ```text
   list
   documents: 
     memory/lease-notes.md — lease-notes
   ```

   读取不取得发布所有权，另一个写入持有租约时照常返回。读取记下前像、缺失路径、目录成员与发布 revision，返回当前结果前再核对。历史诊断查询遵守[异步投影](../../local-data-engine/use-case/query-asynchronous-projections.md)。

2. 提交写入时遇到另一个写入。 {#contention}

   ```sh
   concord new memory busy-note
   ```

   ```text
   ok: false
   error: OperationFailed
   message: exclusive publication lease is busy (pid=4182 host=my-host mode=exclusive); retry after the operation finishes. For an interrupted operation run concord recover; do not delete the lease directory.
   ```

   普通写入先在没有独占租约的情况下准备计划，只在提交时取得独占所有权，核对全部依赖与前像后才写 journal。同步提交遇到占用立即报告；显式快照与恢复最多异步等待三秒。超时报告 PID、主机与模式，不撤销对方的所有权，也不重放修改。等对方完成后重试。

3. 另一个写入的进程异常退出后继续写。 {#dead-owner}

   ```sh
   concord new memory after-crash
   ```

   ```text
   Applied new:
     memory/after-crash.md

   Next: edit the pages, then run concord check.
   ```

   观察到的每个 owner 都属于本 worktree 与本主机、并确认 ESRCH 时，普通写入准入回收这些 token 并重试一次。它不恢复 journal，也不回收 runner 所有权；之后到达的新 owner 不会被回收。

4. 发布被打断，或想确认协调状态时，运行恢复。 {#recover}

   ```sh
   concord recover
   ```

   ```text
   Recovery: clean
   Journal: clean
   Publication tokens reclaimed: 1
   Runner: absent
   ```

   再运行一次 `concord recover --json`，已没有可回收的 token：

   ```json
   {"operation":"recover","status":"clean","changedPaths":[],"journalStatus":"clean","coordination":{"publication":{"reclaimedTokens":[]},"runner":{"status":"absent"}}}
   ```

   恢复在独占保护下核对 journal 与 runner 状态，发布完整计划或回到前像，并只释放观察到的那个 token。显式恢复保留 token 收据，不自动回收新到达的 owner。未知元数据与外部编辑保持原样。

## 结果

| 情形 | 结果 |
| --- | --- |
| 打包后的 CLI，`PATH` 中没有 flock、diskutil、plutil 或 stat | 正常工作 |
| 打开两个仓库 | 都不取得贯穿命令的写锁 |
| 两个提交竞争 | 互斥，后到者报告占用 |
| 读取与写入并发 | 读者不阻塞写者；读到一半有发布时拒绝当前结果 |
| 两次读取观察之间有完整发布，包括 A→B→A 的编辑 | revision 变化，当前结果被拒绝 |
| 只有活着或已死亡的发布 token | 不阻塞普通读取 |
| 有未完成的 journal | 普通读取返回 `RecoveryRequired` |
| 授权依赖、缺失文件或扫描的目录变化，写入目标没变 | 计划失效 |
| 不同 worktree，包括 linked worktree | 不共享所有权 |
| 死亡 owner 的恢复与新到达的写者并发 | 不删除新 owner |
| 持有者被 SIGKILL 且没有 journal | `recover` 回收它的精确 token 并在 `reclaimedTokens` 报告；之后 Memory 的 list 与 annotate 成功 |
| 活着或身份未知的 owner | 永不回收 |
| 发布期间进程被杀 | 留下可恢复的 journal；`recover` 保留未知的外部编辑 |
| 内容既不匹配前像也不匹配计划摘要 | 保留现场，交给人判断 |
| 存在多个 journal | 具名冲突，先于 runner 结果报告；保留现场 |
| 第一次独占检查就发现 runner blocked | 不开始 journal 恢复；有 journal 时 `journalStatus` 为 pending，没有时为 clean；`changedPaths` 为空 |
| 处理 journal 后最终独占检查遇到占用 | 返回占用，之前的 journal 结果不算完成的恢复 |
| 处理 journal 后 runner 变为 blocked | `journalStatus` 保留已产生的结果，`status` 为 blocked |
| runner 被隔离（quarantined） | Memory 读取可用、写入失败；`recover` 报告 runner blocked，不删除 runner 现场 |
| runner 为 blocked | 带具名原因，CLI 失败；Web 与 action 返回同样的状态字段 |
| `recover` 的输出 | `operation`、journal 结果、`changedPaths` 与 `coordination`；`coordination.publication.reclaimedTokens` 列出回收的 token，`coordination.runner.status` 为 absent、running 或 blocked |
| `recover` 与 runner 文件 | 不删除 `runner.lease`、运行状态、证据或未知文件 |
| 测试执行期间发布无关文档 | 不被阻塞；输入变化或清理不确定时不能产生通过的证据 |
| 认领或释放失败、owner 元数据未知、PID 是否存在不确定 | 失败并保留现场 |
| 删除缓存 | 只影响可丢弃的缓存状态 |
| 不安全路径 | 按[路径安全](../../local-sdlc/architecture.md#路径安全)拒绝 |

访问模式、读者准入、恢复结果的字段与数据流见[架构](../architecture.md)。
