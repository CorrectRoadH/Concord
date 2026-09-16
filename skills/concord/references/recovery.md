# 缓存与中断恢复

SQLite 只是可删除重建的解析缓存。它位于 `git rev-parse --git-path concord` 返回目录下的 `cache.sqlite`，普通 checkout 通常是 `.git/concord/cache.sqlite`，linked worktree 则位于对应 Git-private 目录，不是项目根的 `.concord`。状态与维护命令：

```sh
concord cache status --json
concord cache clear
concord cache rebuild
```

缓存损坏、schema 不符或写失败时，查询应回退权威源码而非返回陈旧关系。`cache clear` 不删除 evidence、journal 或 Memory。`cache rebuild` 不接受 `--dry-run`。

文档、配置、Memory 与源码写入共享配置快照、锁、preimage journal 和逐文件原子 rename。配置正常编辑可规范化 TS，恢复严格还原冻结的原文字节。普通读取发现当前格式的未完成 journal 时停止并报告 RecoveryRequired；确认写入进程已经退出后执行：

```sh
concord recover --json
```

恢复只会在当前内容等于 preimage 或 planned digest 时回滚或完成。若返回 `RecoveryConflict`，保留外部编辑和 journal，查明冲突后再处理；不要删除 journal、强抢锁、覆盖未知编辑或用 cache 命令绕过恢复。

`JournalMigrationRequired` 表示历史事务，只能显式离线恢复；保留 journal、锁和目标文件，不反复调用普通 recover。`ProjectMigrationRequired` 表示旧配置须先离线迁移。缺当前配置绑定的旧收据返回 `EvidenceMigrationRequired`，保留原收据并重新取证。

`--dry-run` 走同一规划校验，不发布项目文件；已有 owner 的仓库仍须共享 lease 和两套 journal 障碍，可能首次创建协调锁。只有全新且无 owner/锁的 init 预览可以完全不创建私有状态。它不等于真实发布完成。`recover` 不接受 `--dry-run`。
