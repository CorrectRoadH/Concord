# per-command-open

## Problem

保持现行进程模型：每个命令进程按需打开 HawDB、用完即关。在此之上加入持久解析投影、按命令加载代码与关闭时的显式维护，以减少 [Problem](../../README.md#problem) 中的成本。

## Core Mental Model

- 每个命令独立完成全部工作；没有跨命令存活的进程。
- 解析投影与 hawdb-owner-service 第 2 阶段相同：键为路径、原文摘要与解析器身份，来源仍每次读取并核对。
- 维护只能在命令关闭可写句柄时进行，依次调用 `checkpoint`、两个 compaction 入口与 `reclaim_branch_storage`。超出准入上限或失败时，在释放全部原生锁后按现行清理协议丢弃缓存。

详细机制见 [Architecture](architecture.md)。

## Scope

包含：持久解析投影与单次解析、按命令拆分的生产构建、静态版本与帮助、关闭时的维护调用。

不包含：任何跨命令存活的进程。

接受的取舍：并发命令仍竞争同一目录；维护占用命令自身的时间；命令固定开销受限于每次加载命令代码。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-缓存成功结果与同源重建一致) | pending | 来源核验保持现行规则；投影键含路径 | 待 Cases 对照 |
| [L2](../../LIMITS.md#l2-不跳过安全与完整性检查) | satisfied | 不跳过任何校验 | 设计推理 |
| [L3](../../LIMITS.md#l3-hawdb-只保存可重建缓存) | satisfied | 存储内容与清理协议不变 | 设计推理 |
| [L4](../../LIMITS.md#l4-写入发布与证据核对原文字节) | satisfied | 写入路径不变 | 设计推理 |
| [L5](../../LIMITS.md#l5-按引擎规定持有-hawdb) | not-satisfied | 多个命令进程轮流打开同一目录，并发时互相占用；进程存活时间不足以运行引擎后台维护，只能在关闭时同步调用维护入口 | 固定 revision README 第 153、157 行；只读打开也取得排他句柄锁（`native/hawdb/src/lib.rs:254`） |
| [L6](../../LIMITS.md#l6-本地可安装无部署服务) | satisfied | 无额外进程 | 设计推理 |
| [L7](../../LIMITS.md#l7-固定依赖不变) | satisfied | 只调用固定 revision 已公开的维护入口 | 设计推理 |
| [L8](../../LIMITS.md#l8-公开输出不变) | satisfied | 命令仍在原进程执行 | 设计推理 |
| [L9](../../LIMITS.md#l9-严格-typescript-与-effect) | satisfied | 无新语言边界 | 设计推理 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-启动在-50-ms-以内) | partial | 静态版本与帮助可达；其余命令的固定开销不可达 | spike-startup：完全打包后真实命令约 139 ms，最小 Effect CLI 约 73 ms |
| [G2](../../GOALS.md#g2-缓存已热的只读命令为百毫秒级) | pending | 免解析；每次仍打开库与目录检查，并受 G1 的固定开销约束 | 待实测 |
| [G3](../../GOALS.md#g3-少量变更只付出变更文件的成本) | pending | 未命中的文件单独解析 | 待 C6 |
| [G4](../../GOALS.md#g4-缓存体积与打开耗时不随使用时间增长) | pending | 关闭时同步维护；超限丢弃重建 | 待 C7 |
| [G5](../../GOALS.md#g5-并发调用互不串行) | not-satisfied | 并发命令竞争排他句柄锁，竞争者只能回源 | 2026-10-29 `trace show` 首次返回 HawdbBusy |
| [G6](../../GOALS.md#g6-支撑分钟级交付门禁) | partial | 解析成本下降，固定开销与并发竞争仍在 | 推算 |
| [G7](../../GOALS.md#g7-引擎能力不在外部重写) | partial | 维护调用引擎入口，但时机与超限丢弃由 Concord 编排；检索仍在 TypeScript | 设计推理 |
| [G8](../../GOALS.md#g8-面板与-web-实时显示来源变化) | partial | 现行 View 进程可监听与推送，但与 CLI 共享目录，仍需刷新租约与忙重试；面板需各自扫描或读取持久代次 | 设计推理 |

## Entry Points

- [Architecture](architecture.md)
