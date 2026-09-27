# 缓存与中断恢复

HawDB 只拥有可重建投影与可丢弃缓存。它位于 `git rev-parse --git-path concord` 返回目录下的 `cache.hawdb`，普通 checkout 通常是 `.git/concord/cache.hawdb`，linked worktree 则位于对应 Git-private 目录，不是项目根的 `.concord`。状态与维护命令：

```sh
concord cache status --json
concord cache clear
concord cache rebuild
```

缓存损坏、schema 不符或写失败时，查询应回退权威源码而非返回陈旧声明或关系。`cache clear` 不删除 evidence、journal 或 Memory。`cache rebuild` 不接受 `--dry-run`。

`cache clear` 通过与固定 HawDB revision 相同的所有权锁清理数据，保留目录和锁 inode；不要手工删除 owner.hawdb.lock 来抢占。只读观察、status 和 dry-run 不补建引擎或锁文件。clear 可能因占用、路径异常或 I/O 失败而拒绝或部分完成；保留现场，处理原因后重试，不把打开失败当作可删证明。

缓存只管理 cache.hawdb，目录外文件不参与状态判定或清理。clear --dry-run 展示清理条目、保留路径与原生产物可用性；真实执行重新验证所有权。native binary digest differs 表示安装产物与包内摘要不符，应修复安装，清缓存不能修复该错误。远端快照消失后需显式 fetch 才能刷新，本地已捕获 Issue 与 Memory 保留。短期解析及 Git baseline 使用进程内 HawDB；清理当前进程不表示其它进程的短期缓存也已清空，它们仍须核对当前来源。

文档、配置、Memory 与源码写入使用短 publication lease、preimage journal 和逐文件原子 rename。查询声明 `access: read`，使用共享 snapshot，并拒绝真正发布。非 dry-run 的写入、外部执行、恢复、cache rebuild 与 cache clear 使用独占 snapshot。dry-run 预览沿用共享 snapshot，不授权实际发布。配置正常编辑可规范化 TS，恢复严格还原冻结的原文字节。普通读取发现未完成 journal 时停止并报告 RecoveryRequired。确认写入进程已经退出后执行：

```sh
concord recover --json
```

恢复先记录并回收观察到的已死 publication token，再在独占保护下选择唯一 journal。后续引擎不隐式回收新到达的 owner；即使该 owner 已死，本次也返回 Busy，留待下一次显式恢复记录。只在当前内容等于 preimage 或 planned digest 时回滚或完成。`RecoveryConflict` 保留外部编辑和 journal，多 journal 冲突先于 runner 报告。不要删 journal、抢锁或用 cache 命令绕过恢复。

同 worktree、同 host、最多一个 exclusive 加多个 shared 是合法加入暂态。全部 owner 均已确认 ESRCH 时，recover 逐 token 回收该暂态。任一活 owner、第二个 exclusive、未知文件、host 不匹配、EPERM、PID 复用或未知 owner 都保留现场。恢复不以年龄推断死亡。回收死 token 只证明这些 token 的 ESRCH，不解释未复现的 macOS 现场原因。

共享 token 加入现有目录后，须重读完整 owner 集合。只有自己的 token 存在，且全部 owner 为同 worktree 的 shared，才开始受保护读取。writer 已替换目录时，加入者撤销自己的 token 并报告 Busy，不能开始读取。writer 释放时只删除自己的 owner。尚未通过准入的 shared 记录不授予读取，也不阻止 writer 释放。

`JournalMigrationRequired` 表示历史事务，只能显式离线恢复；保留 journal、锁和目标文件，不反复调用普通 recover。`ProjectMigrationRequired` 表示配置不受支持；当前工具不提供格式转换入口，保留原件并使用匹配版本处理。缺当前配置绑定的旧收据返回 `EvidenceMigrationRequired`，保留原收据并重新取证。

`--dry-run` 与 access 分开。它走同一规划校验，不发布项目文件。既有 dry-run 仍是预览，不会因为查询使用 read 而变成写入。已有 owner 的仓库仍须短快照 lease 和当前 journal 障碍，可能首次创建私有协调目录。只有全新且无 owner/锁的 init 预览可以完全不创建私有状态。它不等于真实发布完成。`recover` 不接受 `--dry-run`。


0.6.0 使用 Node 文件 API 的短 publication lease，不需要外部 flock 或磁盘探测程序。`concord recover` 自动选择唯一的当前普通或 Trace journal，多 journal 时保留并拒绝。HawDB 仅为可清空缓存；不要把 journal、evidence、runner.lease 或 run 状态当作缓存删除。测试运行期间允许文档发布，但会使该次运行失效，即使稍后撤销修改也不会重新有效。runner 的 finalizing/quarantined、死父 PID 或未知状态阻断后续写操作；父进程死亡不证明子进程清理完成，必须先确认进程现场。不提供旧锁迁移或混合版本协调。

恢复完成后重新取得短独占快照，直接核验 worktree 私有协调路径上的当前 journal 与 runner。init 回滚后不要求配置文件仍在。并发新发布可使最终核验 Busy。Busy 时早先的 journal 结果不是恢复完成，保留新 owner 后重试。

`--json` 返回 `operation`、原 journal 结果、`changedPaths` 和 `coordination`。`journalStatus` 保留 journal 处理结果。`coordination.publication.reclaimedTokens` 列出已回收 token。`coordination.runner.status` 为 `absent`、`running` 或 `blocked`；blocked 带具名原因。无事务且 runner 为 absent 或健康 running 时可以返回 clean。runner 不确定时返回 blocked，并保留 journal 的实际处理结果。CLI 对 blocked 使用失败退出码。Web 与 action 保留相同状态字段。

初次独占检查已发现 runner blocked 时，不开始任何 journal 恢复。此时 `journalStatus` 为 pending 或 clean，`changedPaths` 为空。journal 恢复之后 runner 变为 blocked 时，保留已完成的 `journalStatus`，总 status 设为 blocked。统一入口保留 prepared 和 committed 现场。recover 不删除 runner.lease、run state、证据或未知文件。blocked 表示当前操作无法恢复完整写能力。持久缓存句柄在 snapshot 结束前关闭。读取期间的缓存更新不取得独占发布锁；缓存不能安全使用时回源。
