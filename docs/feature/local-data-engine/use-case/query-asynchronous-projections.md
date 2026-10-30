---
format: concord.document/v1
id: query-asynchronous-projections
title: 读取异步刷新的诊断投影
kind: use-case
feature: docs/feature/local-data-engine/README.md
---

# 读取异步刷新的诊断投影

用户执行 trace show、trace gaps 或 review render 时，CLI 立即读取最近完成的诊断投影，并请求后台刷新。首次无缓存返回 QueryPending，退出码为 1；该状态不表示没有问题。--fresh 使用当前来源并等待扫描结果，--dry-run 不启动后台刷新。

JSON 的 `projection` 对象如下（预期输出，时间为示例）：

```json
{
  "projection": {
    "current": false,
    "builtAt": "2026-10-06T03:12:40.311Z",
    "builtFrom": "2026-10-06T03:11:02.904Z",
    "builtUntil": "2026-10-06T03:12:40.118Z",
    "consistent": false,
    "complete": false,
    "changedPaths": ["docs/feature/npc/README.md"],
    "unknownRelations": true,
    "unknown": [],
    "refresh": "requested",
    "lastAttempt": { "scannedAt": 1791256801000, "at": "2026-10-06T03:20:01.000Z", "complete": false, "changedPaths": ["docs/feature/npc/README.md"] },
    "bodyChanged": []
  }
}
```

`current` 恒为 false。`builtFrom` 与 `builtUntil` 是扫描区间，`builtAt` 是发布时间。`consistent` 只回答构建期间观察到的来源是否保持不变；不一致时 `complete` 为 false、`unknownRelations` 为 true，`changedPaths` 列出变化路径，`.` 表示范围未知。代码来源无法稳定读取时 `unknown` 为 `["code"]`。

最近一次刷新失败时附 `lastError`（含 `code`、`message`、`scannedAt`，超时另含 `elapsedMs` 与 `limitMs`）。`lastError.code` 是开放集合，以 `lastError` 是否存在判断最近一次刷新是否失败。

已知码有 `QueryRefreshTimedOut`、`QueryRefreshOutputLimit`、`QueryRefreshFailed`、`QueryRefreshCleanupUnconfirmed`，扫描的具名失败保留原码，例如 `TraceInvalid`、`InvalidConfig`。无投影时 QueryPending 的 `details.refresh` 为同一失败对象，尚无失败时为 `"requested"`。历史结果只回答构建时的诊断问题，不承诺当前文件有效。

consistent: false 的投影退出码为 0，但 gap 列表可能偏大，零 gap 不表示没有缺口；unknown 非空时对应关系类别整体未知。消费者须检查 projection.consistent 后再使用列表。已有一致投影不被不一致结果替换，此后的不一致尝试只记录在 `lastAttempt`。check、trace check、Memory/Issue 检索、作者读取和证据裁决使用当前来源。

人类输出展示历史快照、一致性与刷新状态。`consistent: false` 时于结果前打印 `历史投影，构建期间来源变化（N 个路径），关系可能不完整；使用 --fresh 获取当前结果。`；已有一致投影且 `lastAttempt.complete` 为 false 时打印 `一致结果构建于 <builtAt>，此后的刷新在编辑中未能取得一致结果（最近 <lastAttempt.at>）。`

投影不复用于不同的 worktree、命令参数、配置字节或安装；扫描期间这些身份变化时丢弃结果并按新身份刷新，不记为失败。恢复待处理、配置无效、路径安全失败和无法形成结构的扫描不发布投影。缓存严格解码失败报告 `QueryCacheInvalid`，数据库占用时报告暂不可用；两者都不在查询进程执行全量扫描。前台缓存读取暂不可用时最多重试 500ms，每次重新执行完整路径和 Schema 核验，仍不可读则具名报告；该等待不取得 publication lease，也不执行来源扫描。

后台刷新合并同键请求，只合并开始于请求之后的扫描；等待同键刷新与来源扫描共用[刷新上限](#刷新上限)，超时不声明刷新成功。成功以事务替换完整结果，失败保留上一代，数据库可写时记录具名错误。进程在终端退出后可继续完成刷新，不持有文档 publication lease。发布阶段的数据库占用最多重试三秒，进程终止后的清理以清理宽限为界，二者不计入刷新上限。扫描消息输出上限为 4MiB。

投影不保存 owner 正文与远端 Issue 正文。trace show 与 review render 在服务时读取当前正文（单文件上限 32MiB）。摘要与投影记录一致时，输出排除 `projection` 与 `cache` 后与同源 `--fresh --dry-run` 逐字节相同。摘要变化时省略该正文并在 `projection.bodyChanged` 列出路径，读取失败时列入 `projection.bodyUnavailable` 并附错误码。review render 中变化的宪法片段输出 `(constitution changed since projection; use --fresh)`。

缓存清理只删除可丢弃投影。没有原生产物或数据库不可用时，--fresh 仍可通过现有回源能力执行诊断。

快照内条目被按大小写改名时，当前来源查询在快照结束时报 PreimageChanged，历史投影把该条目列入变化路径；非普通文件在初次读取或扫描时报 InvalidFile，核验阶段报 UnsafePath；symlink 与越界在任何阶段都报 UnsafePath（[路径安全](../../local-sdlc/architecture.md#路径安全)）。

## 验收

采用打包后安装到隔离 Git 仓库的 CLI：

- 首次构建返回 QueryPending，退出后刷新完成；历史命中、刷新失败保留结果、--fresh、check 使用当前来源、并发文档写入不被扫描阻塞、进程超时和缓存清理。
- 冷缓存仓库中，后台写者在整个刷新扫描期间每隔几毫秒改写一个已观察的 docs、测试或代码文件：`trace gaps --json` 退出码 0，`consistent` 为 false，`changedPaths` 含该文件，`unknownRelations` 为 true。代码文件情形 `unknown` 为 `["code"]`，人类输出带不完整提示。
- 已有一致投影时下一次刷新被编辑：继续服务原投影，`lastAttempt` 记录时间、不完整与变化路径，不写 `lastError`。
- 扫描超过刷新上限：`lastError.code` 为 `QueryRefreshTimedOut` 并含 `elapsedMs` 与 `limitMs`；无投影时 QueryPending 的 `details.refresh` 给出同一错误。测试以短上限参数直接调用内部刷新入口，不新增用户可触发的环境变量。
- 扫描以具名错误失败（例如 `InvalidConfig`）或存在非漂移 finding：保留原错误码，非漂移 finding 记为 `TraceInvalid`；`RecoveryRequired` 不发布投影。
- 扫描期间改写 `concord.config.ts`：候选丢弃，不发布、不记为失败，按新身份重新刷新。
- 同一 worktree 的工作区投影与 trace gaps 投影在同一编辑下构建：`consistent`、`complete`、`changedPaths`、`unknownRelations`、`lastAttempt` 与替换结果一致，`builtAt` 不参与比较。
- 投影建成后修改 owner 正文：持久 payload 不含 owner 正文与远端正文字节；摘要未变时输出与同源 `--fresh --dry-run` 相同，摘要变化时出现在 `bodyChanged`。

## 性能预算

按[性能验收](../../../engineering/concord-self-hosting/performance.md)的参照消费者、环境及七次新进程采样，已有可读投影的读取命令满足以下 warm p50 预算。冷缓存报告构建状态，不把后台扫描耗时计为前台成功结果。当前来源模式另外执行原有命令预算和同机交错对照。

| 场景 | 测量内容 | p50 预算 |
| --- | --- | ---: |
| `local-data-engine/trace-gaps-warm`、`local-data-engine/trace-show-warm`、`local-data-engine/review-render-warm` | 已有诊断投影的历史读取 | 600ms |
| `local-data-engine/cache-status` | 缓存状态 | 670ms |

## 刷新上限

后台刷新进程通过内部扫描入口执行下表场景的当前来源扫描，三类查询各有一行；测量对象是该内部入口。从刷新进程开始等待同键刷新到扫描子进程退出的总时间不得超过上限；超出即终止扫描，结果不发布，此时没有上一代投影的仓库持续返回 QueryPending。上限按最大值在任何机器判定，测量规模包括[性能验收](../../../engineering/concord-self-hosting/performance.md#消费者)的 `scale` 消费者。

| 场景 | 测量内容 | 上限 |
| --- | --- | ---: |
| `local-data-engine/trace-gaps-refresh` | 关系缺口来源扫描 | 120000ms |
| `local-data-engine/trace-show-refresh` | 单个 Feature 关系扫描 | 120000ms |
| `local-data-engine/review-render-refresh` | 审阅材料来源扫描 | 120000ms |
