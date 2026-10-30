---
format: concord.document/v1
id: cli-hot-path
title: CLI 热路径与 HawDB 进程模型
createdAt: 2026-10-29T13:34:01.670Z
kind: design
alternatives:
  - hawdb-owner-service
  - per-command-open
  - workspace-server
---

# CLI 热路径与 HawDB 进程模型

## Problem

Concord 是 agent 高频调用的本地工具（[C-014](../../constitution.md#c-014-1)），本仓库的交付门禁也由数千次 CLI 调用组成。2026-10-29 在参照机器（AMD Ryzen 7 5800X，Linux x64，Node 24.19.0）上实测，缓存已热的本仓库中 `concord check` 需 2.9 s、`doctor` 5.4 s、`docs check` 1.1 s。`--version` 需约 310 ms，而空 `node -e 0` 为 30 ms。

剖析得到四项成本：

1. 启动：`--version` 的约 280 ms 中，约 210 ms 用于加载与编译 121 个 dist ESM 模块及 effect，与所执行的命令无关。打包后，只加载 Effect 核心的程序约 30 ms，加上 Effect CLI 与 NodeServices 的最小命令仍约 74 ms（热编译缓存）。
2. 缓存目录无界增长：本仓库 `cache.hawdb` 达约 470 MB（按 inode 去重），同一仓库的新克隆为 8.4 MB。`openHawdb` 因此从 57 ms 增至 1118 ms。
3. 缓存命中仍解析：文档解析结果只存在于进程期内存命名空间，每个进程都重新解析全部文档；steps 与标题锚点还各解析一次。小缓存下 `check` 的 1.7 s 中 markdown 解析占 693 ms。相比之下，读取本仓库全部 934 个来源文件并计算 sha256 约 14 ms。
4. 并发调用互相阻塞：多个 agent 同时运行时，只读命令会以 `HawdbBusy` 失败。

### 根因：Concord 没有按 HawDB 的设计使用它

HawDB 是供一个进程长期持有的嵌入式数据库：「一个目录只有一个写租约，由一个进程持有；从另一个进程打开同一路径会立即失败」（固定 revision 的 README 第 153 行），「多进程写入不在本版本范围内」（README 第 312 行、`docs/STORAGE.md` 第 1198 行）。compaction 等后台工作「只在宿主启用时运行」（README 第 157 行）。

Concord 的现行设计与之相反：

- 许多短命进程各自打开同一目录，句柄「在短快照内按需打开，不跨网络请求或 Web 空闲时间持有」（[HawDB 引擎设计](../hawdb-data-engine/plans/native-embedded/README.md#mechanism)）。为此手写了跨进程句柄锁与 `HawdbBusy` 重试；只读打开同样取得排他的句柄锁（`native/hawdb/src/lib.rs:254`、`:173`–`:187`），并发读者只能回源。
- `native/hawdb/Cargo.toml` 以 `default-features = false` 引入 HawDB，关闭了 background-maintenance 与 full-text-search。固定 revision 已有的 `Database::compact_relational_row_pages` 与 `compact_relational_overflow` 从未调用，稀疏的旧物理代次与不可达的 checkpoint 产物持续累积。
- 持久数据全部存为 `(namespace, key, payload)` 一张表，条数上限、淘汰顺序与重建由绑定手写；Memory 与 Issue 检索另在 TypeScript 中实现。

第 2、4 项成本直接来自这一错配；第 3 项是缺少持久解析投影；第 1 项是每个进程都要加载整个 CLI。

### 新增的消费者

[Herdr 面板](../../feature/herdr-panel/README.md)要求终端面板与 Web 工作台在 agent 写入后一秒内显示新内容，并与 agent 的 CLI 调用同时运行（[G8](GOALS.md#g8-面板与-web-实时显示来源变化)）。这需要某个进程持续监听来源、保持解析结果，并把新代次推送给多个客户端。现在的 `concord view` 已经是这样一个按 worktree 常驻的进程，但它与 CLI、其它 View 进程共享 HawDB 目录，所以需要刷新租约、`HawdbBusy` 重试与持久代次交换。

需要决定的是：由谁长期持有 HawDB、在哪里保持解析结果与推送代次。候选有三个：每个用户一个托管 HawDB 的后台（hawdb-owner-service）；每个 worktree 一个持有缓存并提供领域查询与订阅的工作区服务（workspace-server）；保持每个命令各自打开（per-command-open）。

## Core Mental Model

- 所有者进程：在任一时刻持有某个 HawDB 目录的唯一进程。
- 热路径：缓存有效、来源未变时，一次命令从进程启动到退出的全部工作。
- 解析投影：一篇来源在某个 canonical 路径下、以某个解析器与 Schema 身份解析得到的结果。它的键包含路径、原文摘要与解析器身份；命中仍要求本次读取的原文摘要相等。
- 来源核验不变：每次命令照常列举来源集合、读取原文并计算摘要，返回前按现行规则复核。缓存只省去解析，不省去读取。

比较标准见 [Goals](GOALS.md)，硬约束见 [Limits](LIMITS.md)，共同场景见 [Cases](CASES.md)。

## Scope and Tradeoffs

范围：HawDB 的进程归属与句柄生命周期、缓存的物理维护、持久解析投影、CLI 启动与命令执行的位置，以及相应的性能预算。

不在范围：测试运行器的文件内并发、CI 原生产物缓存与并行门禁快照，它们属于[自举维护](../../engineering/concord-self-hosting/README.md)的工程机制。

取舍：不以文件系统指纹代替读取原文。读取与摘要的全部成本约 14 ms，而按 stat 判定未变需要修订 [C-014-3](../../constitution.md#c-014-3)，且独立审查给出了粗粒度时间戳下返回陈旧摘要的反例。来源核验因此保持现行语义。

两个候选共有的改动不依赖本次裁决，已写入 Spec：单次解析见[架构 · 存储 Spec](../../architecture.md#存储-spec)，缓存物理体积上限见[统一缓存](../../feature/local-data-engine/use-case/use-unified-cache.md)，静态版本与帮助及按命令加载见 [local-sdlc 架构](../../feature/local-sdlc/architecture.md#入口与命令加载)。持久解析投影只在长期持有数据库时可能有收益，归入 hawdb-owner-service。本设计只比较 HawDB 由谁持有、命令在哪里执行。

## 宪法修订提案

选择 hawdb-owner-service 或 workspace-server 时修订 [C-005-4](../../constitution.md#c-005)，它现在规定持久句柄受来源快照生命周期管理：

> 持久句柄由明确的唯一所有者管理，来源快照不拥有跨请求句柄；客户端的逻辑会话、事务、快照与清理的生命周期分别声明。缓存不参与来源发布或证据裁决。

修订由 `concord constitution amend` 记录（[C-008](../../constitution.md#c-008-2)），同步维护 architecture、AGENTS.md 与引擎 Spec。

## 随之修订的架构规则

选择 hawdb-owner-service 时，以下现行规则随之改写，内容见该候选的 [architecture](plans/hawdb-owner-service/architecture.md#受影响的现行-spec)：

- [HawDB 引擎设计](../hawdb-data-engine/plans/native-embedded/README.md)的 Mechanism、Open modes and ownership 与 Resource budgets。
- [架构 · 存储 Spec](../../architecture.md#存储-spec) 与[发布协调](../../architecture.md#发布协调)中关于持久句柄随来源快照结束、在 publication lease 之前释放的规则。
- AGENTS.md 原生边界一段中的「Persistent handles end with the source snapshot」。

## Entry Points

- [Goals](GOALS.md)
- [Limits](LIMITS.md)
- [Cases](CASES.md)
- [Decision](DECISION.md)
- 候选：[hawdb-owner-service](plans/hawdb-owner-service/README.md)、[workspace-server](plans/workspace-server/README.md)、[per-command-open](plans/per-command-open/README.md)

## Constitution

- [C-001](../../constitution.md#c-001)
- [C-002](../../constitution.md#c-002)
- [C-003](../../constitution.md#c-003)
- [C-004](../../constitution.md#c-004)
- [C-005](../../constitution.md#c-005)
- [C-014](../../constitution.md#c-014)
- [C-015](../../constitution.md#c-015)
