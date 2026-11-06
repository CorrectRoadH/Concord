# 短发布租约

Concord 用 Node 文件租约协调一个 worktree 的写入，HawDB 只是可丢弃的缓存。本页负责乐观的来源访问、独占提交与恢复结果。用户路径见[协调本地发布](use-case/coordinate-local-publications.md)。

每种操作的依赖矩阵见[本地 SDLC 架构](../local-sdlc/architecture.md#操作依赖)。runner 租约与证据定稿见[项目架构](../../architecture.md#发布协调)。理由：操作边界。

## 实体归属 {#entity-ownership}

来源查询不取得发布所有权。它记录文件前像、缺失路径和目录成员，并在返回前核对它们。

独占持有者进入和退出时，持久化的发布修订号都会前进。修订号变化时，当前结果以 `SourceChanged` 拒绝。未完成的 journal 仍然阻止当前快照成功。

普通文档修改乐观地制定计划，只在提交时取得独占租约。提交先核对配置、观察记录和整个变更集，再写 journal 并发布文件。并发的计划不能覆盖胜出的写入者。显式写快照保护 runner 状态转换与恢复，不包裹普通查询。

历史诊断投影存放在 HawDB 中，异步刷新。它们的新鲜度与失败行为见[查询异步投影](../local-data-engine/use-case/query-asynchronous-projections.md)。它们从不授权发布，也不决定检查成功或证据结论。

runner 状态与数据库目录所有权各自保持边界。持久句柄在来源快照结束前关闭。访问缓存从不需要发布所有权。

## 访问模式 {#access-modes}

`LocalRepository` 接受显式的 `access: 'read' | 'write'`。read 使用乐观的来源快照，拒绝真实发布。普通 write 乐观地制定计划，只在提交时取得独占租约。

dry-run 决定计划是否发布，与 access 无关；它复用乐观快照，从不授权发布。已有的 `dryRun` 调用方保持预览语义。

每个普通 CLI 查询都声明 read，CLI 动作与 Web 共用一套动作分类。只有外部执行、恢复、缓存重建或清除，以及文档写入使用 write。

构造仓库对象不持有租约。同步的计划与读取在短快照中运行，交互、网络请求和测试执行不在快照中运行。固定证据校验与它的 Memory 写入共用一个快照。读取期间的缓存更新从不构成取得独占租约的理由；缓存无法安全使用时，读取回退到来源。

## 数据流 {#data-flow}

申领时，在租约旁的唯一临时目录中写入带新 token 的完整持有者文件并 fsync。随后把该目录 rename 到租约路径，并在受保护的工作开始前 fsync 父目录。已被占用的租约不能被替换。未知元数据、symlink、多余文件、持久化失败或身份不确定时 fail closed。

释放与失效持有者回收只 unlink 观察到的那个 token 文件。只有 unlink 成功后才可以尝试非递归 rmdir；`ENOTEMPTY` 时保留新的持有者。

租约目录从不被递归删除，也不因存在时间长而被夺取。关闭是幂等的。普通写入准入可以回收一组观察到的、全部失效的持有者并重试一次，不处理 journal 或 runner 所有权。未知主机、存活或被复用的 PID、`EPERM` 和未知记录都保留现场。

来源查询不回收存活或失效的发布 token。写入者与恢复串行修改，来源读者检测漂移。缓存引擎可用时，来源发布期间历史缓存的命中仍可读取。

恢复先记录并回收观察到的失效发布 token，再在独占保护下选出唯一的 journal。之后的引擎阶段不再回收。

新的持有者出现时，即使它随后失效，本次调用也返回 `Busy`；之后的显式恢复会记录对它的回收。普通恢复或 Trace 恢复取一个新的短独占快照，随后做最终的 journal 与 runner 核对。

这次核对直接使用 worktree 私有的协调路径，不要求 init 回滚后仍保留配置文件。并发的发布可以使最终核对返回 `Busy`；这时之前的 journal 结果不算一次完成的恢复。

## 不变量 {#invariants}

- read 访问拒绝发布。dry-run 表示预览，从不发布来源改动，也不启动后台刷新。
- 来源读取不取得共享所有权，而是核对观察记录与发布修订号。部分解析遵循同一规则。
- 处于 prepared 与 committed 的 journal 保持可恢复；未知编辑不能被覆盖。
- HawDB 目录所有权与 runner 清理不依赖查询投影。
- 恢复成功描述的是经过核对的协调状态，而不只是没有 journal。

## 错误 {#errors}

相互竞争的写入者报告 `Busy`。多个 journal 是一个具名冲突；该冲突先于 runner 结果报告，并保留现场。既不匹配前像也不匹配 planned digest 的内容保留下来，由人判断。

恢复结果保留 `operation`、journal 结果和 `changedPaths`，另加 `coordination`。发布部分列出 `reclaimedTokens`。runner 状态为 `absent`、`running` 或 `blocked`，`blocked` 带具名原因。

没有事务时，`absent` 或健康的 `running` 可以返回 `clean`。runner 状态不确定时返回 `blocked`，并保留实际产生的 journal 结果。

如果第一次独占核对已经发现 runner 为 `blocked`，不开始 journal 恢复。此时存在 journal 则 journal 状态为 `pending`，不存在则为 `clean`；changed paths 为空。

如果 runner 在 journal 处理之后变为 `blocked`，已完成的 journal 状态保留，整体状态变为 `blocked`。CLI 在 `blocked` 时失败，Web 与动作返回相同的状态字段。

## 身份与复用 {#identity-and-reuse}

每个 token 都是精确的。释放与失效持有者回收只删除那个 token；恢复期间到来的新写入者不会被删除。独立的 worktree 不共享租约。只支持当前的协调协议：旧的锁格式不迁移，不同版本的可执行程序混用时不做协调。

## Trace 发布与恢复协议

`concord repo` 的关系写入、结构写入和 Feedback 信封导入共用一套 Trace 发布协议。基础 CLI 的本地 Issue 写入使用基础发布 journal，由 `concord recover` 恢复。两者争用同一 `publication.lease`，不并发发布。短期租约、读者准入与恢复结果见上文[访问模式](#access-modes)，本节只声明 Trace 专属的 journal 与恢复规则。

### 协调目录与租约

协调状态位于 `git rev-parse --git-path concord/trace`，每个 worktree 独立。目录中有以下文件：

- `publication.lease`：短期发布租约，由 Node 文件租约实现。
- `coordination-id`：随机 UUID，用于 worktree 身份。
- 两种 journal：`publication-journal.json` 与 `multi-file-publication-journal.json`。

支持边界是单机本地文件系统。跨主机共享同一 worktree 不受支持；无法确认租约归属时 fail closed。

读者不取得租约。返回结果前，读者必须重新核对它读过的每个文件的摘要与目录集合，并确认没有未完成的 journal：

- 存在 journal 时返回 `TraceRecoveryRequired`，提示运行 `concord repo docs trace recover`。
- 任何读过的文件或目录集合变化时，按[一致读取](#一致读取)重试或失败。

读者不修改 owner 或 journal；首次读取可以初始化 coordination-id。

写者与 recover 只在提交阶段取得独占租约，先保守恢复旧 journal，再开始新的 publication。提交前的编译在已持有的租约下重新执行，不重新打开或升级锁。

### 一致读取

编译连续两次枚举并读取全部 Trace 输入。两次的路径集合与字节相同后，只用第二次的内存捕获编译；不同则最多重试三次，之后返回 `TraceInputChanged`。返回前再核对一次全部摘要、目录集合与 journal，变化返回 `TraceSnapshotChanged`。跨文件发布期间读到“旧 a 加新 b”时，末次核对会发现 a 已变化。

这只证明捕获前后一致，不证明线性快照。文件改回原来的字节（ABA）得到同一结论，无害。

### 文件发布

单文件与多文件 publication 的 journal 以 mode `0600` 写入，单个 owner 不超过 32 MiB。journal 记录以下内容：

- 每个文件的前像（字节、digest、mode）与 planned digest、mode。
- 当前阶段。
- HEAD、Git index 条目与 worktree 身份。

多文件 journal 的阶段依次为 `prepared` → `publishing` → `committed` → `cleanup`：

1. **prepared**：journal durable 后，在目标同目录写临时文件并 fsync。
2. **publishing**：逐个核对前像，rename 到目标并 fsync 目录。删除使用 planned `absent`。
3. **committed**：全部目标就位后，把 journal 的阶段 durable 改为 `committed`。这是唯一 commit point。
4. **cleanup**：删除 journal。

写者在 commit point 之后首次清理失败时，在同一独占租约内保守恢复。恢复证明 planned owner 完整后返回成功 receipt，不出现“已提交却报告未提交”的重试歧义。

### 目录发布

新 Feature 或 Design 目录先在同级 `.stage-<uuid>` 中构建 manifest，再原子 rename 到目标。Feedback 信封导入的 Issue owner 与附件使用多文件发布，每个新文件的前像为 `absent`。

回滚时先把目标原子移回 stage，再把 journal durable 切换到 `discarding-stage`。重复恢复只删除原 manifest 的精确剩余子集。

### 恢复规则

`trace recover` 按 journal 的阶段判断：

- 已到 `committed`：只在全部 owner 匹配 planned digest 且没有残留临时文件时完成 journal。
- 未到 `committed`：只在每个 owner 匹配前像或 planned digest 时回滚到前像并丢弃临时文件。
- 其它情形：返回 `TraceRecoveryConflict`，保留 owner、stage 与 journal。

以下变化同样返回 `TraceRecoveryConflict` 并保留现场：额外路径、symlink、特殊文件，以及 identity、HEAD、index、mode 或 digest 的变化。恢复从不改写与 journal 状态不符的 owner。

不使用 Trace 租约的编辑器在最终前像检查与 rename 之间仍有极窄的保存竞态。协议只保证已观察到的并发编辑会阻止 publication。

### 验收

每个 journal 阶段被中断后，结果只能是三种之一：完整旧状态、完整新状态，或保留 owner 与 journal 的具名冲突。领域测试覆盖以下注入点：rename 后、`committed` 写入后、`discarding-stage` 删除中，以及外部编辑冲突。
