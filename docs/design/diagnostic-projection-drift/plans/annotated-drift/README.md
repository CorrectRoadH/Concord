# annotated-drift

## Problem

诊断投影在来源漂移下拒绝入库，持续编辑的仓库可能永远没有第一份投影；刷新失败没有可区分的原因。

## Core Mental Model

刷新扫描改用与工作区导航相同的投影观察原语 `LocalRepository.observeProjection`：扫描照常完成，扫描内部复核产生的漂移 finding 先分拣为漂移，返回值与构建期间的漂移一起交给刷新进程。漂移结果以 `consistent: false` 发布，已有一致投影不被替换；失败按具名分类追加到同一条记录。投影只保存派生结构，正文在服务时定向读取。

## Scope

改动刷新扫描入口、投影记录格式、替换规则、JSON 与人类输出，以及失败分类。前台缓存读取路径、刷新上限、合并规则、`--fresh` 当前来源查询与 check 不变。接受的取舍：不一致投影可能遗漏跨文件关系，由 `unknownRelations` 与人类提示承担；trace show 与 review render 在服务时多一次定向文件读取。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-no-current-authority) | satisfied | `current` 恒为 false；check、trace check 与证据路径不读取 query_cache | [架构](architecture.md#授权边界) |
| [L2](../../LIMITS.md#l2-unknown-stays-unknown) | satisfied | 不一致投影携带 `unknownRelations: true`，人类输出加提示；一致投影不被不一致投影替换 | [架构](architecture.md#替换规则) |
| [L3](../../LIMITS.md#l3-strict-decoding-and-identity) | satisfied | 每个查询的值 Schema；身份变化丢弃候选；恢复与配置失败不发布 | [架构](architecture.md#投影记录) |
| [L4](../../LIMITS.md#l4-owner-bytes-stay-out-of-the-cache) | satisfied | 持久值去掉正文，只存路径与摘要；服务时定向读取 | [架构](architecture.md#正文边界) |
| [L5](../../LIMITS.md#l5-compatible-machine-output) | satisfied | 只新增 projection 字段与错误码，保留 scannedAt；`lastError.code` 声明为开放集合；不一致投影退出码 0 的含义在契约中声明 | [CLI](cli.md) |
| [L6](../../LIMITS.md#l6-bounded-refresh) | satisfied | 沿用刷新上限、输出上限、单 owner 与发布重试；record、lastAttempt、error 都保留 scannedAt，同键合并可判定请求已满足 | [架构](architecture.md#刷新扫描) |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-first-projection-under-continuous-edits) | satisfied | 漂移分拣后，docs、测试与代码编辑下的结果都可作为第一份投影发布；扫描超时仍无投影，由性能优化解决 | 场景 C1 |
| [G2](../../GOALS.md#g2-explainable-refresh-state) | satisfied | 具名失败码，超时附耗时与上限 | 场景 C3、C4 |
| [G3](../../GOALS.md#g3-one-drift-semantics) | satisfied | `consistent`、`complete`、`changedPaths`、`unknownRelations`、lastAttempt 与替换规则按工作区实现对齐；声明的例外是 `builtAt` 保留 v2 的发布时间含义 | 场景 C5 |

## Entry Points

- [Library](library.md)
- [CLI](cli.md)
- [Architecture](architecture.md)
