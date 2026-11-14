# 写入协调与恢复

Concord 通过工作区服务的进程内读写调度、CAS 摘要核对与单一 `journal.json` 协调一个 worktree 的写入，HawDB 只是可丢弃的缓存。本页负责来源读取、原子写入与自动恢复。用户路径见[协调本地发布](use-case/coordinate-local-publications.md)。

每种操作的依赖矩阵见[本地 SDLC 架构](../local-sdlc/architecture.md#操作依赖)。外部观察任务槽位与观察发布见[项目架构的发布协调](../../architecture.md#发布协调)，按操作声明依赖的理由见[操作依赖与发布协调](../../architecture.md#操作依赖与发布协调)。

## 实体归属 {#entity-ownership}

来源查询直接读取工作区服务的增量工作区图与按 `(mtime, size, inode)` 校验的文件状态，不阻塞并发读取。

文档与源码修改先基于当前工作区图制定计划，只在提交阶段进入工作区服务的写互斥：核对目标文件的期望摘要与变更集后，写单一 `journal.json` 并以同目录临时文件原子 `rename` 替换，随后立即增量更新内存工作区图并删除 `journal.json`。并发的写入计划若目标文件摘要已变，则以 `FileChangedSinceRead` 或 `SourceChanged` 拒绝，不能覆盖胜出的写入者。

历史诊断投影存放在 HawDB 中，它们的新鲜度与失败行为见[查询异步投影](../local-data-engine/use-case/query-asynchronous-projections.md)。它们从不授权发布，也不决定检查成功或证据结论。

## 访问模式 {#access-modes}

操作区分 `access: 'read' | 'write'`。read 访问当前[来源快照](concepts.md#source-snapshot)，拒绝真实发布。普通 write 先在只读来源快照中制定计划，只在提交时进入写互斥。

dry-run 决定计划是否发布，与 access 无关；它执行与真实写入相同的规划校验，不发布 owner、journal 或缓存。`recover` 不接受 dry-run。

每个普通 CLI 查询都声明 read，CLI 动作与 Web 共用一套动作分类。只有外部执行、恢复、缓存重建或清除，以及文档与源码写入使用 write。

## 数据流 {#data-flow}

工作区服务持有唯一的 `server/lock`，[写互斥](../../concepts.md#write-exclusion)与[外部观察任务槽位](concepts.md#observation-slot)都是服务内存中的信号量。命令在本进程内运行内核时同样先取得 `server/lock`，因此磁盘上没有第二种协调锁，也没有需要回收的持有记录。

写入在服务内排队进入写互斥，最多等待 3 秒，超时返回 `RepositoryBusy`。进入后核对计划依赖的全部文件摘要，任一变化即以 `SourceChanged` 拒绝。

服务取得 `server/lock` 后、开始应答请求前，以及运行 `concord recover` 时，在写互斥下检查是否存在上次异常退出遗留的 `journal.json`：

- 若目标文件当前内容仍等于写入前摘要或计划摘要，自动回滚到写入前内容或补完计划写入，并删除 `journal.json`。
- 若目标文件已被外部编辑器或 agent 修改（既不等于写入前摘要也不等于计划摘要），或 `journal.json` 属于无法解码的陈旧格式，则遵循“工作区文件是最终事实来源”（[文件是界面，命令只是助手](../../taste.md#t-6)），保留磁盘上的当前文件、清理陈旧 `journal.json` 并输出告警，绝不锁死仓库。

## 不变量 {#invariants}

- read 访问拒绝发布。dry-run 表示预览，从不发布来源改动。
- 来源读取按 `(mtime, size, inode)` 与内容摘要核对文件一致性，不阻塞并发读取。
- 写入提交前核对目标文件的期望摘要，防止无意覆盖并发的外部编辑。
- 服务启动与显式恢复自动清理中断的 `journal.json`，外部编辑优先于陈旧 journal。

## 错误 {#errors}

相互竞争的写入若依赖了被先到者改变的文件，后者以 `SourceChanged` 拒绝。恢复结果报告 `operation`、`status`、`journalStatus`（`clean`、`completed`、`rolledBack` 或 `discarded`）、`changedPaths`、`warnings` 与[外部观察任务状态](concepts.md#observation-slot-status)。外部观察子进程组清理无法确认时报告 `blocked`。

## 身份与复用 {#identity-and-reuse}

独立的 worktree 各自拥有独立的 Git-private 协调目录与工作区服务，互不干扰。只支持当前的协调协议：不维护历史格式兼容分支。

## Trace 发布与恢复协议

关系写入、目录创建、Feedback 导入与普通文档写入统一使用同一套发布与 `journal.json` 恢复协议，由工作区服务或 `concord recover` 统一处理。

### 协调目录

协调状态位于 `git rev-parse --git-path concord`（在创建工作区时解析一次并缓存），每个 worktree 独立。目录中包含：

- `server/lock`：工作区服务的唯一实例锁。
- `journal.json`：统一的写入恢复记录。

支持边界是单机本地文件系统。跨主机共享同一 worktree 不受支持。

### 一致读取

读取与关系图编译使用工作区服务的增量工作区图：文件未发生 `(mtime, size, inode)` 变化时直接复用已解析的 AST 与摘要；变化的文件在本次读取中重新读取字节并计算摘要，不再执行双遍全量目录枚举。

### 文件发布

单文件与多文件 publication 的 `journal.json` 以 mode `0600` 写入，单个 owner 不超过 32 MiB。journal 记录每个目标文件的写入前摘要、计划内容摘要、mode 与当前阶段（`prepared` → `committed`）：

1. **prepared**：`journal.json` 落盘后，在目标同目录写临时文件并 fsync。
2. **publishing**：逐个核对目标文件当前摘要仍等于写入前摘要，随后 `rename` 到目标路径。删除使用 planned `absent`。
3. **committed**：全部目标就位后，更新内存工作区图并删除 `journal.json`。

### 目录发布

新 Feature 或 Design 目录先在同级 `.stage-<uuid>` 中构建完整文件集合，再原子 `rename` 到目标目录。回滚时先把目标移回 stage 并清理临时目录。

### 恢复规则

`journal.json` 的恢复按目标文件当前状态判断：

- 已全部匹配计划摘要：清理残留临时文件并删除 `journal.json`。
- 未全部完成且目标文件仍匹配写入前摘要或计划摘要：回滚到写入前内容并删除临时文件与 `journal.json`。
- 目标文件已被外部编辑器修改：保留磁盘当前文件，清理临时文件与陈旧 `journal.json`，并在恢复结果中记录外部编辑优先告警。

### 验收

写入阶段被中断后，自动恢复要么还原为完整旧状态、要么完成为完整新状态；若期间存在外部编辑，则保留外部编辑并清理陈旧 journal，仓库始终保持可读写状态。
