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

JSON 的 projection 标明 current: false、builtAt 和 refresh，并在可用时附 lastError。人类输出同样展示历史快照与刷新状态。历史结果只回答构建时的诊断问题，不承诺当前文件有效。check、trace check、Memory/Issue 检索、作者读取和证据裁决使用当前来源。

HawDB 中的完整查询投影绑定 worktree、命令参数、配置字节和实现身份。严格解码失败或数据库占用时报告暂不可用，不在查询进程执行全量扫描。后台刷新合并同键请求，最多运行两分钟；成功以事务替换完整结果，失败保留上一代，数据库可写时记录具名错误。进程在终端退出后可继续完成刷新，不持有文档 publication lease。后台来源扫描不持有持久解析缓存句柄，仅在最终发布投影时短暂访问数据库；短暂占用最多重试三秒。

刷新来源按文件、目录集合和发布代次进行一致性核验；变化不能被发布为当前成功快照。缓存清理只删除可丢弃投影。没有原生产物或数据库不可用时，--fresh 仍可通过现有回源能力执行诊断。

验收采用打包后安装到隔离 Git 仓库的 CLI，覆盖首次构建、退出后完成、历史命中、刷新失败保留结果、--fresh、check 当前来源、并发文档写入、进程超时和缓存清理。

按[性能验收](../../../engineering/concord-self-hosting/performance.md)的参照消费者、环境及七次新进程采样，已有可读投影的 trace gaps、trace show 与 review render 的 warm p50 不超过 600ms。冷缓存报告构建状态，不把后台扫描耗时计为前台成功结果。当前来源模式另外执行原有命令预算和同机交错对照。

前台缓存读取暂不可用时最多重试 500ms，每次重新执行完整路径和 Schema 核验，仍不可读则具名报告；该等待不取得 publication lease，也不执行来源扫描。

刷新结果记录扫描开始时间；只合并开始于请求之后的扫描。占用中的刷新请求最多等待两分钟预算内的剩余时间，超时不声明刷新成功。输出限制为 4MiB，结果与错误共用一条原子记录；成功清除旧错误，失败不因新增错误行淘汰该结果。投影身份包含原生二进制和元数据，子进程整个执行窗口的发布代次变化使结果拒绝入库。
