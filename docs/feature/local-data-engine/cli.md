# 缓存与历史投影的命令输出

本页列出缓存命令与读取历史投影的命令的输出字段与错误。使用流程见[替换持久缓存](use-case/use-unified-cache.md)与[读取异步刷新的诊断投影](use-case/query-asynchronous-projections.md)。

## 缓存状态

`concord cache status` 报告持久缓存的状态，`--json` 在顶层给出同名字段：

| 字段 | 含义 |
| --- | --- |
| `status` | `ready` 表示投影可读，不表示某次扫描命中 |
| `path` | 缓存目录 |
| `detail` | 可读的投影命名空间 |
| `physicalBytes`、`reclaimThresholdBytes` | 缓存的物理体积，与触发空间回收的体积（[目录体积与维护](architecture.md#目录体积与维护)）；体积不设上限 |
| `owner` | `service`：由工作区服务持有；`process`：没有服务，由当前 CLI 进程持有 |
| `pid` | 持有者的进程号（整数） |
| `installation` | 持有者的[安装身份](../../concepts.md#installation-identity)，与 `concord server status` 的 `installation` 相同 |
| `sourceDigest` | 服务持有时是服务当前结果的摘要 |

## 清理缓存

`concord cache clear --dry-run` 列出 `engine`、`path`、`existing`、待删除的顶层条目 `remove`、保留路径 `preserve`、原生产物可用性 `native.status` 与 `ownership: checked-on-execution`。预览不取得清理锁，也不创建缓存；预览成功不授权删除。

`concord cache clear` 成功时输出 `status: cleared` 与 `path`。

## 等待下一份结果

```sh
concord --json workspace wait --after <sourceDigest> [--timeout <秒>]
```

命令自动启动或复用工作区服务，在服务接受一份 `sourceDigest` 与 `--after` 不同的结果时返回；省略 `--after` 或当前结果已经不同时立即返回。服务还没有接受过结果时，先等首份结果。超时（默认 25 秒，上限 120 秒）返回 `changed: false`，`sourceDigest` 为当前结果的摘要，还没有结果时为 `null`。它给不能保持 socket 订阅的调用方（例如经 Herdr 在远程机器上运行的 Concord mod）一个长等待，语义与[订阅](architecture.md#刷新与推送)相同：只是信号，调用方收到后再读结果。

```json
{"operation":"workspace-wait","changed":true,"sourceDigest":"sha256:..."}
```

| 情形 | 结果 |
| --- | --- |
| 服务无法启动，例如原生产物缺失 | 返回服务的具名错误（如 `HawdbUnavailable`），退出 1 |
| 刷新失败 | 照常等待；最近一次失败见 `workspace projection` 的 `lastError` |
| 服务在等待期间停止 | 返回 `WorkspaceServerUnavailable`，调用方重新运行即可启动新服务 |

## 历史投影

`trace gaps`、`trace show` 与 `review` 默认读取最近完成的投影，`--json` 输出中的 `projection` 描述它：

| 字段 | 含义 |
| --- | --- |
| `current` | 恒为 `false`：结果不表示当前来源有效 |
| `builtFrom`、`builtUntil` | 扫描区间 |
| `builtAt` | 发布时间 |
| `scannedAt` | 这次扫描的序号时间戳 |
| `consistent` | 构建期间观察到的来源是否保持不变 |
| `complete` | 扫描完整；不一致时为 `false` |
| `changedPaths` | 构建期间变化的路径，排序去重；`.` 表示范围未知 |
| `unknownRelations` | 关系是否未知；不一致时为 `true`，零 gap 也不表示没有缺口 |
| `unknown` | 整体未知的关系类别，例如代码来源无法稳定读取时为 `["code"]` |
| `refresh` | 这次读取请求的后台刷新状态，例如 `requested` |
| `lastAttempt` | 保留上一份一致结果时，最近一次尝试的 `scannedAt`、`at`、`complete` 与 `changedPaths` |
| `lastError` | 可选；最近一次刷新失败时给出 `code`、`message` 与 `scannedAt`，超时另含 `elapsedMs` 与 `limitMs` |
| `bodyChanged` | 投影之后正文已变化的条目 |

`lastError` 是否存在表示最近一次刷新是否失败。`lastError.code` 是开放集合，已知码有 `QueryRefreshTimedOut`、`QueryRefreshOutputLimit`、`QueryRefreshFailed` 与 `QueryRefreshCleanupUnconfirmed`；扫描的具名失败保留原码，例如 `TraceInvalid`、`InvalidConfig`。

| 错误 | 条件 |
| --- | --- |
| `QueryPending` | 等待首次刷新结束后仍没有可读的投影；`details.refresh` 是最近一次失败对象，尚无失败时为 `"requested"`；退出 1 |
| `QueryCacheInvalid` | 投影记录无法严格解码 |

不一致的结果仍以 0 退出，消费者先检查 `projection.consistent` 再使用列表。`--fresh` 使用当前来源并等待扫描结果；`--dry-run` 不启动后台刷新。
