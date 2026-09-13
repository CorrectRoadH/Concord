# 缓存与中断恢复

SQLite 只是可删除重建的解析缓存。它位于 `git rev-parse --git-path concord` 返回目录下的 `cache.sqlite`，普通 checkout 通常是 `.git/concord/cache.sqlite`，linked worktree 则位于对应 Git-private 目录，不是项目根的 `.concord`。状态与维护命令：

```sh
concord cache status --json
concord cache clear
concord cache rebuild
```

缓存损坏、schema 不符或写失败时，查询应回退权威源码而非返回陈旧关系。`cache clear` 不删除 evidence、journal 或 Memory。`cache rebuild` 不接受 `--dry-run`。

文档写入使用锁、preimage journal 和逐文件原子 rename。普通读取发现未完成 journal 时停止并报告 recovery required；确认写入进程已经退出后执行：

```sh
concord recover --json
```

恢复只会在当前内容等于 preimage 或 planned digest 时回滚或完成。若返回 `RecoveryConflict`，保留外部编辑和 journal，查明冲突后再处理；不要删除 journal、强抢锁、覆盖未知编辑或用 cache 命令绕过恢复。

`--dry-run` 走同一规划校验但不写文件、不创建 Git-private 状态；它不等于真实发布完成。`recover` 不接受 `--dry-run`。
