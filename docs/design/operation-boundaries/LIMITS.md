# Limits

## L1: Preserve publication safety

未完成 journal、路径逃逸、symlink、配置漂移、前像冲突仍拒绝。局部依赖不放宽完整事务与资源互斥。

## L2: Preserve evidence

fixed 与 runner 状态、证据下限和清理核验保持原要求；局部观察不能签发证明。未知 runner 清理状态仍阻断发布。

## L3: Exact ownership

canonical path 查询验证目标与最近 owner 边界；短 ID 必须扫描该类来源并拒绝歧义及无法解析的候选，不推断文件名等于 ID。集合查询不能悄悄省略其范围内的坏记录。

## L4: Recover exact owners

只回收同主机、同 worktree、ESRCH 的准确 publication token；活 owner、PID 复用、未知元数据均保留。runner 不自动回收。回收与新 writer 并发不得删除新 token。
