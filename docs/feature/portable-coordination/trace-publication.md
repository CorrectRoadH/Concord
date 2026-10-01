# Trace 发布与恢复协议

`concord repo` 的关系写入、结构写入和 Feedback 信封导入共用一套 Trace 发布协议。基础 CLI 的本地 Issue 写入使用基础发布 journal，由 `concord recover` 恢复。两者争用同一 `publication.lease`，不并发发布。短期租约、读者准入与恢复结果由 [Short publication leases](architecture.md) 拥有，本页只声明 Trace 专属的 journal、generation 与恢复规则。消费项目只链接本页，不复述协议细节。

## 协调目录与租约

协调状态位于 `git rev-parse --git-path concord/trace`，每个 worktree 独立。目录中有以下文件：

- `publication.lease`：短期发布租约，由 Node 文件 lease 实现。
- `generation`：单调递增整数。
- `coordination-id`：随机 UUID，用于 worktree 身份。
- 两种 journal：`publication-journal.json` 与 `multi-file-publication-journal.json`。

支持边界是单机本地文件系统。跨主机共享同一 worktree 不受支持；无法确认租约归属时 fail closed。

读者不取得租约。读取前后核对 publication revision 与 generation，并检查是否存在 journal：

- 存在 journal 时返回 `TraceRecoveryRequired`，提示运行 `concord repo docs trace recover`。
- revision 或 generation 变化时按[一致读取](#一致读取)重试或失败。

读者不修改 owner、journal 或 generation；首次读取可以初始化 coordination-id。

写者与 recover 只在提交阶段取得 exclusive lease，先保守恢复旧 journal，再开始新的 publication。提交前的编译在已持有的 lease 下重新执行，不重新打开或升级锁。

## 一致读取

编译连续两次枚举并读取全部 Trace 输入。两次的路径集合与字节相同后，只用第二次的内存捕获编译；不同则最多重试三次，之后返回 `TraceInputChanged`。读取前后核对 generation 与 publication revision，变化返回 `TraceSnapshotChanged`。

这只证明两次完整捕获一致，不证明线性快照，也不识别 ABA。

## 文件发布

单文件与多文件 publication 的 journal 以 mode `0600` 写入，单个 owner 不超过 32 MiB。journal 记录以下内容：

- 每个文件的前像（字节、digest、mode）与 planned digest、mode。
- 旧、新 generation。
- HEAD、Git index 条目与 worktree 身份。

多文件 journal 的阶段依次为 `prepared` → `publishing` → `generation-committed` → `cleanup`：

1. **prepared**：journal durable 后，在目标同目录写临时文件并 fsync。
2. **publishing**：逐个核对前像，rename 到目标并 fsync 目录。删除使用 planned `absent`。
3. **generation-committed**：durable 替换 `generation` 为新值。这是唯一 commit point。
4. **cleanup**：删除 journal。

写者在 commit point 之后首次清理失败时，在同一 exclusive lease 内保守恢复。恢复证明 planned owner 与新 generation 完整后返回成功 receipt，不出现“已提交却报告未提交”的重试歧义。

## 目录发布

新 Feature 或 Design 目录先在同级 `.stage-<uuid>` 中构建 manifest，再原子 rename 到目标。Feedback 信封导入的 Issue owner 与附件使用多文件发布，每个新文件的前像为 `absent`。

回滚时先把目标原子移回 stage，再把 journal durable 切换到 `discarding-stage`。重复恢复只删除原 manifest 的精确剩余子集。

## 恢复规则

`trace recover` 按 generation 判断：

- generation 等于新值：只在全部 owner 匹配 planned digest 且没有残留临时文件时完成 journal。
- generation 等于旧值：只在 owner 仍匹配前像时回滚并丢弃临时文件。
- 其它值：返回 `TraceRecoveryConflict`，保留 owner、stage 与 journal。

以下变化同样返回 `TraceRecoveryConflict` 并保留现场：额外路径、symlink、特殊文件，以及 identity、generation、HEAD、index、mode 或 digest 的变化。恢复从不改写与 journal 状态不符的 owner。

不使用 Trace lease 的编辑器在最终前像检查与 rename 之间仍有极窄的保存竞态。协议只保证已观察到的并发编辑会阻止 publication。

## 验收

每个 journal 阶段被中断后，结果只能是三种之一：完整旧状态、完整新状态，或保留 owner 与 journal 的具名冲突。领域测试覆盖以下注入点：rename 后、generation 提交后、`discarding-stage` 删除中，以及外部编辑冲突。
