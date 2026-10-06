---
format: concord.document/v1
id: query-asynchronous-projections
title: 读取异步刷新的诊断投影
createdAt: 2026-09-28T05:39:06.816Z
kind: use-case
feature: docs/feature/local-data-engine/README.md
---

# 读取异步刷新的诊断投影

用户执行 trace show、trace gaps 或 review render 时，CLI 立即读取最近完成的诊断投影，并请求后台刷新。首次无缓存返回 QueryPending，退出码为 1；该状态不表示没有问题。--fresh 使用当前来源并等待扫描结果，--dry-run 不启动后台刷新。

JSON 的 projection 标明 current: false、构建区间、一致性、完整性和 refresh，并在可用时附 lastAttempt 与 lastError。构建区间字段为 builtAt、builtFrom、builtUntil；一致性与完整性字段为 consistent、complete、changedPaths、unknownRelations、unknown。字段与漂移规则见[诊断投影的漂移发布](../../../design/diagnostic-projection-drift/plans/annotated-drift/architecture.md)。lastError.code 是开放集合，以 lastError 是否存在判断最近一次刷新是否失败。人类输出同样展示历史快照、一致性与刷新状态。历史结果只回答构建时的诊断问题，不承诺当前文件有效。

consistent: false 的投影退出码为 0，但 gap 列表可能偏大，零 gap 不表示没有缺口；unknown 非空时对应关系类别整体未知。消费者须检查 projection.consistent 后再使用列表。check、trace check、Memory/Issue 检索、作者读取和证据裁决使用当前来源。

HawDB 中的完整查询投影绑定 worktree、命令参数、配置字节和实现身份。严格解码失败或数据库占用时报告暂不可用，不在查询进程执行全量扫描。后台刷新合并同键请求，等待同键刷新与来源扫描共用[刷新上限](#刷新上限)；成功以事务替换完整结果，失败保留上一代，数据库可写时记录具名错误。进程在终端退出后可继续完成刷新，不持有文档 publication lease。后台来源扫描不持有持久解析缓存句柄，仅在最终发布投影时短暂访问数据库；短暂占用最多重试三秒。

刷新来源按文件、目录集合和发布代次进行一致性核验。构建期间有变化的结果以 consistent: false 发布并列出变化路径，永不替换已有的一致投影；变化结果不能被发布为一致快照。缓存清理只删除可丢弃投影。没有原生产物或数据库不可用时，--fresh 仍可通过现有回源能力执行诊断。

验收采用打包后安装到隔离 Git 仓库的 CLI，覆盖首次构建、退出后完成、历史命中、刷新失败保留结果、--fresh、check 当前来源、并发文档写入、进程超时和缓存清理。

快照内条目被按大小写改名时，当前来源查询在快照结束时报 PreimageChanged，历史投影把该条目列入变化路径；非普通文件在初次读取或扫描时报 InvalidFile，核验阶段报 UnsafePath；symlink 与越界在任何阶段都报 UnsafePath。规则见[读取路径安全检查的成本边界](../../../design/path-safety-cost/plans/anchored-root/architecture.md)。

前台缓存读取暂不可用时最多重试 500ms，每次重新执行完整路径和 Schema 核验，仍不可读则具名报告；该等待不取得 publication lease，也不执行来源扫描。

刷新结果记录扫描开始时间；只合并开始于请求之后的扫描。占用中的刷新请求只在刷新上限的剩余时间内等待，超时不声明刷新成功。发布阶段的数据库重试与进程终止后的清理不计入刷新上限，分别以三秒重试和进程清理宽限为界。单文件正文经 storage 的 `readRepositoryFileSync` 读取，沿用仓库读取上限 32MiB（`MAX_BYTES`）。扫描消息输出上限为 4MiB，二者分别约束正文与消息。结果与错误共用一条原子记录；成功清除旧错误，失败不因新增错误行淘汰该结果。投影身份包含原生二进制和元数据，扫描前后身份键不同时丢弃候选并以新键重新请求；子进程执行窗口内的发布代次变化使结果标为不一致。

## 性能预算

按[性能验收](../../../engineering/concord-self-hosting/performance.md)的参照消费者、环境及七次新进程采样，已有可读投影的读取命令满足以下 warm p50 预算。冷缓存报告构建状态，不把后台扫描耗时计为前台成功结果。当前来源模式另外执行原有命令预算和同机交错对照。

| 基准命令（参数完整） | p50 预算 |
| --- | ---: |
| `concord trace gaps`、`concord trace show docs/feature/local-sdlc/README.md`、`concord review render local-sdlc` | 600ms |

## 刷新上限

后台刷新进程通过内部扫描入口执行下表查询的当前来源扫描，三类查询各有一行；测量对象是该内部入口，表中命令标识被测查询。从刷新进程开始等待同键刷新到扫描子进程退出的总时间不得超过上限；超出即终止扫描，结果不发布，此时没有上一代投影的仓库持续返回 QueryPending。上限按最大值在任何机器判定，测量规模包括[性能验收](../../../engineering/concord-self-hosting/performance.md#消费者)的 `scale` 消费者。

| 刷新扫描命令（参数完整） | 上限 |
| --- | ---: |
| `concord --json --fresh --dry-run trace gaps` | 120000ms |
| `concord --json --fresh --dry-run trace show docs/feature/local-sdlc/README.md` | 120000ms |
| `concord --json --fresh --dry-run review render local-sdlc` | 120000ms |
