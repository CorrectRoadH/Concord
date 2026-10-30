# workspace-server

## Problem

每个 worktree 最多运行一个工作区服务。它是该 worktree 持久 HawDB 目录唯一的打开者，在 HawDB 内存命名空间中长期保持解析结果，监听来源变化并刷新投影，通过本机 socket 向Herdr 面板、Web 工作台与 CLI 提供领域查询和代次订阅。客户端从不取得 HawDB 句柄，只收到经过校验的领域结果。

现行 `concord view` 已是按 worktree 常驻、带监听与刷新的进程；本方案把它的进程模型收敛为唯一的缓存持有者，再让面板与 CLI 成为它的客户端。

## Core Mental Model

- 工作区服务：某个 worktree 当前唯一持有缓存的 Concord 进程。取得该 worktree 原生目录锁的进程就是服务，锁是唯一裁决。
- 缓存就是 HawDB：解析结果放在服务进程的 HawDB 内存命名空间里，随服务存活而保持热；不新增持久解析投影，也不在 HawDB 之外手写缓存。
- 客户端只拿结果：面板订阅代次，Web 由服务直接托管，CLI 发出有类型的查询；没有远程数据库句柄，也不在服务中执行任意命令。
- 服务可有可无：服务未运行时，命令按现行方式在本进程计算；服务运行时，其它进程不打开持久目录，只用内存缓存，不等待也不报告 `HawdbBusy`。
- 写入不经过服务：写入、发布、恢复与证据仍由发起的进程按现行租约协议完成，服务通过监听与核验看到结果。

详细机制见 [Architecture](architecture.md)。

## Scope

包含：服务的启动、身份、锁裁决、运行记录与退出；本机 socket 协议；监听驱动的刷新与代次推送；`concord panel` 客户端与 Herdr 插件；由服务托管的 Web 工作台；第 2 阶段 CLI 只读查询经由服务。

不包含：在服务中执行任意 CLI 命令、跨 worktree 或跨用户共享进程、全文检索迁入引擎。它们若需要，各自另行设计。

接受的取舍：每个打开面板或 Web 的 worktree 多一个常驻进程；CLI 命令不自动启动服务，只有面板、`concord view` 与 `concord server start` 会启动它；服务运行时，其它进程的持久缓存降为内存缓存。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-缓存成功结果与同源重建一致) | pending | 白名单查询在计算进程中以新的乐观快照执行同一领域函数，服务只提供热解析缓存；历史查询保留原语义 | 审查 F2 后的 Spec；待 C1–C10、C20 |
| [L2](../../LIMITS.md#l2-不跳过安全与完整性检查) | satisfied | 监听只触发刷新，不替代读取与摘要；路径安全、Schema 与完整性检查不变 | 设计推理 |
| [L3](../../LIMITS.md#l3-hawdb-只保存可重建缓存) | satisfied | 存储内容与清理协议不变；其它进程降为内存缓存不改变结果 | 设计推理 |
| [L4](../../LIMITS.md#l4-写入发布与证据核对原文字节) | satisfied | 写入不经过服务 | 设计推理 |
| [L5](../../LIMITS.md#l5-按引擎规定持有-hawdb) | pending | 服务长期持有；当前版本的其它进程发现服务后不打开；物理上由协调锁保证唯一打开者；物理维护仍由 Concord 编排 | 待 C7、C21、C24 |
| [L6](../../LIMITS.md#l6-本地可安装无部署服务) | satisfied | 服务由 Concord 按需启动、空闲退出；不可用时命令在本进程完成 | 待 C16 |
| [L7](../../LIMITS.md#l7-固定依赖不变) | satisfied | 不启用新的 HawDB feature，不改 revision 与工具链；面板新增的终端渲染依赖按精确版本固定 | 设计推理 |
| [L8](../../LIMITS.md#l8-公开输出不变) | pending | 经由服务的查询执行同一领域函数并由 CLI 同一格式化代码输出；新增服务相关错误码 | 待三种方式的输出对照 |
| [L9](../../LIMITS.md#l9-严格-typescript-与-effect) | satisfied | 服务、协议与客户端都在 TypeScript/Effect；原生只新增服务锁，属目录所有权职责 | 设计推理 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-启动在-50-ms-以内) | partial | 静态版本与帮助已达成；第 2 阶段查询客户端只加载协议与该命令的格式化代码，是否达标待测 | 2026-10-29 静态分派实测 44 ms |
| [G2](../../GOALS.md#g2-缓存已热的只读命令为百毫秒级) | pending | 服务运行时免打开库、免解析，只读取并摘要全部来源；服务未运行时不变 | 读取与摘要约 14 ms；待第 2 阶段实测 |
| [G3](../../GOALS.md#g3-少量变更只付出变更文件的成本) | pending | 内存命名空间按路径与摘要命中，只重新解析变化的来源 | 待 C6 |
| [G4](../../GOALS.md#g4-缓存体积与打开耗时不随使用时间增长) | pending | 现行两级物理维护由服务在空闲时运行；打开只在服务启动时发生 | spike-reclaim：长期持有本身不回收，维护仍由 Spec 中的回收与丢弃保证 |
| [G5](../../GOALS.md#g5-并发调用互不串行) | pending | 服务运行时其它进程不争目录；服务内查询共享已发布代次 | 待 C8、C21 |
| [G6](../../GOALS.md#g6-支撑分钟级交付门禁) | partial | 门禁中的临时仓库不启动服务，单次调用成本不因本方案下降；只有 G1 的静态部分生效 | 设计推理 |
| [G7](../../GOALS.md#g7-引擎能力不在外部重写) | partial | 解析结果完全放在 HawDB 内存命名空间，不另建持久投影；物理维护仍由 Concord 编排；检索不在范围内 | 设计推理 |
| [G8](../../GOALS.md#g8-面板与-web-实时显示来源变化) | pending | 一个进程监听、刷新并推送代次，面板与 Web 只订阅；首屏读取已发布代次 | 待 C20–C24 |

## Entry Points

- [Architecture](architecture.md)
