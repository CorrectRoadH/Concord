# hawdb-owner-service

## Problem

按 HawDB 的设计使用它：每个用户运行一个共享的后台进程，长期持有本机各 worktree 的 HawDB 目录并启用引擎的后台维护。CLI、Web view 与后台 worker 都通过它存取缓存，不再各自打开数据库。持久解析投影与后台执行命令在此基础上分阶段加入，后者让 CLI 成为只转发参数的薄客户端。

## Core Mental Model

- HawDB 由一个进程长期持有，这是引擎规定；Concord 的其它进程是它的客户端。
- 托管 HawDB 的部分只负责存取，不读来源、不做判断，所以按原生产物与协议版本区分，能被所有 Concord 安装共享。
- 命令在已加载代码的后台中执行，CLI 进程只做转发，所以启动不再随命令代码的规模增长。
- 后台不可用时，命令在本进程内加载完整 CLI 并持有 HawDB，结果不变，只是失去跨命令复用与启动速度。

详细机制见 [Architecture](architecture.md)。

## Scope

包含：所有者进程与客户端、同步调用桥、版本交接、进程内持有、启用 background-maintenance 与引擎维护入口，以及分阶段加入的持久解析投影、后台执行命令与引擎检索。

不包含：把关系图计算迁入引擎（可在本方案之后单独决策）。

接受的取舍：引入一个按需启动、空闲退出的用户进程及其生命周期管理；客户端每次存取多一次本机 IPC 往返；命令代码须改为从调用上下文服务取得进程级状态。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-缓存成功结果与同源重建一致) | pending | 来源读取、摘要与返回前复核保持现行规则；投影键含路径、摘要与解析器身份 | 待 Cases 对照 |
| [L2](../../LIMITS.md#l2-不跳过安全与完整性检查) | satisfied | 不跳过摘要、Schema、路径与完整性检查；目录检查在所有者打开时执行 | 设计推理 |
| [L3](../../LIMITS.md#l3-hawdb-只保存可重建缓存) | satisfied | 存储内容与清理协议不变 | 设计推理 |
| [L4](../../LIMITS.md#l4-写入发布与证据核对原文字节) | satisfied | 写入、发布、恢复与证据不依赖所有者（不变量 7） | 设计推理 |
| [L5](../../LIMITS.md#l5-按引擎规定持有-hawdb) | pending | 一个目录一个持有者；所有者长期存活，引擎维护得以运行 | 待 C7、C8、C13；spike-reclaim 的维护实测 |
| [L6](../../LIMITS.md#l6-本地可安装无部署服务) | satisfied | 所有者由 Concord 按需启动、空闲退出，不需安装或配置；不可用时进程内持有 | 待 C16 验证 |
| [L7](../../LIMITS.md#l7-固定依赖不变) | pending | 只启用固定 revision 已有的 feature；需重新验证原生产物身份、体积与发行 | 待原生构建实测 |
| [L8](../../LIMITS.md#l8-公开输出不变) | pending | 后台执行的输出须与独立进程逐字节一致；`cache status` 只新增字段 | 待第 3 阶段对照 |
| [L9](../../LIMITS.md#l9-严格-typescript-与-effect) | satisfied | 所有者与客户端在 TypeScript/Effect；原生只增加 feature | 设计推理 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-启动在-50-ms-以内) | pending | 第 3 阶段：静态版本与帮助；其余命令在后台执行，客户端只加载打包的 Effect 核心 | spike-startup：静态版本约 28 ms；打包的 Effect 核心约 30 ms；进程内执行真实命令最好约 139 ms，不可达 |
| [G2](../../GOALS.md#g2-缓存已热的只读命令为百毫秒级) | pending | 免去每次打开库与目录检查；第 2 阶段免解析；读取与摘要约 14 ms | 打开库从 57–1118 ms 降为一次 IPC 连接；待实测 |
| [G3](../../GOALS.md#g3-少量变更只付出变更文件的成本) | pending | 第 2 阶段 | 待 C6 |
| [G4](../../GOALS.md#g4-缓存体积与打开耗时不随使用时间增长) | pending | 引擎 compaction 在所有者中运行；打开只在所有者首次请求时发生 | 待 C7 |
| [G5](../../GOALS.md#g5-并发调用互不串行) | pending | 所有者内的读事务共享已发布快照，不再有跨进程占用 | 待 C8 |
| [G6](../../GOALS.md#g6-支撑分钟级交付门禁) | partial | 单次调用成本下降；门禁时长另需测试并发 | 推算 |
| [G7](../../GOALS.md#g7-引擎能力不在外部重写) | pending | 第 1 阶段删除手写淘汰与代次重建；第 4 阶段检索交给引擎 | 待 C7、C17 |
| [G8](../../GOALS.md#g8-面板与-web-实时显示来源变化) | partial | 消除目录争用，但所有者只托管存取；监听、解析结果与推送仍在各个 View 与面板进程中，多个客户端各自刷新 | 设计推理 |

## Entry Points

- [Architecture](architecture.md)
