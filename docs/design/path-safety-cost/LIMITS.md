# Limits

## L1: No read through an unsafe path

任何读取在读取字节之前，已确认路径上每个仓库内组件都不是 symlink，且仓库根及其祖先仍是打开仓库时验证过的目录；打开文件时不跟随 symlink。不允许先读取、在快照结束时才拒绝。指向仓库外的硬链接与覆盖仓库内目录的挂载不在本约束内，与现状相同。依据 [C-003](../../constitution.md#c-003) 第 1 款与[架构](../../architecture.md)“读写路径拒绝绝对路径、traversal、symlink 组件和超出仓库的 realpath”。

## L2: No time-based trust

不以时间或进程寿命缓存“路径安全通过”。任何复用的目录信息只属于一次快照，并在该快照结束核验中重新比对。依据 [C-014](../../constitution.md#c-014) 第 3 款。

## L3: Darwin spelling stays exact

Darwin 上路径拼写与目录条目的字节一致性仍被强制；快照内的拼写变化使快照结果拒绝（当前查询）或标为漂移（历史投影），漂移路径为被查条目的仓库相对路径。目录中无关条目的增删不得导致拒绝或漂移。核验阶段不得读取被核验的复用信息。依据 [C-003](../../constitution.md#c-003)。

## L4: Writes unchanged

写入、建目录与删除、原子替换、journal、发布 preflight 与 apply、恢复、`discoverRoot` 与 `init` 的路径检查保持逐次完整检查，即使在快照内执行也不使用复用信息；自身写入使快照内的复用信息失效。依据 [C-003](../../constitution.md#c-003)。
