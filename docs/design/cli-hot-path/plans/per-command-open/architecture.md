# per-command-open 架构

本候选只描述到足以比较的深度；与 hawdb-owner-service 相同的部分引用其架构。

## Entity Ownership

| 实体 | 拥有者 | 生命周期 |
| --- | --- | --- |
| HawDB 句柄 | 当前命令进程 | 在来源快照内按需打开，快照结束前关闭（现行规则） |
| 解析投影 | HawDB 持久命名空间 `document_parse_cache` | 同 hawdb-owner-service 的[持久解析投影](../hawdb-owner-service/architecture.md#持久解析投影第-2-阶段) |
| 命令分派表 | 生产构建 | 随安装发布 |

## Data Flow

1. 入口读取构建生成的分派表：版本与帮助直接输出；其余命令按需导入对应的命令 chunk。
2. 命令照常读取来源并核对摘要，解析结果按投影键查询与写回。
3. 可写句柄关闭时，在释放原生锁之前依次调用 `checkpoint`、两个 compaction 入口与 `reclaim_branch_storage`。报告超出准入上限或失败时，先完整关闭并释放全部原生锁，再按现行协议取得清理所需的协调后丢弃缓存。取不到协调时推迟到下一次命令，不承诺本次达到体积上限。

## Invariants

1. 不持有原生锁等待 publication 协调；清理在无持久句柄时按现行顺序取得锁。
2. 维护失败不改变命令结果，只影响缓存可用性。
3. 其余不变量同 hawdb-owner-service 的不变量 2、6、7。

## Errors

维护报错按缓存不可用处理并回源；并发打开冲突沿用 `HawdbBusy` 与回源。

## Identity and Reuse

同 hawdb-owner-service 的持久解析投影。
