# 读取异步刷新的诊断投影

## 用户目标

维护者或 agent 在持续编辑时运行 `trace gaps`、`trace show` 或 `review`，想立即拿到诊断结果，并清楚这份结果构建于何时、是否完整；需要当前结果时再等待扫描。

## 起始状态

- 项目已初始化，含一个 Feature `docs/feature/cart/README.md`，还没有任何诊断投影。
- 诊断投影是后台构建的历史结果，只回答构建时的诊断问题，不承诺当前文件有效。`check`、`trace check`、Memory 与 Issue 检索、作者读取和证据裁决总是使用当前来源。

## 完整路径

1. 第一次运行。 {#first-run}

   ```sh
   concord trace gaps
   ```

   ```text
   Building diagnostic snapshot…
   Diagnostic snapshot: 2026-11-06T07:14:40.112Z (historical; refresh requested)
   trace gaps
   semantics: missing-explicit-relationships-not-coverage
   …
   ```

   还没有投影时，CLI 请求后台刷新并等待这次刷新结束，再读取它发布的投影，按第 2 步的格式输出，退出码与已有投影时相同。查询进程本身不扫描；等待受[刷新上限](../performance.md#刷新上限)约束。人读模式在等待期间向 stderr 打印 `Building diagnostic snapshot…`，`--json` 的 stdout 只有最终结果。中断命令不取消刷新，刷新进程继续完成，不持有文档发布租约。`--dry-run` 不启动刷新，也不等待。

   等待结束仍没有可读投影时（刷新失败、超时，或 `--dry-run`），命令返回 `QueryPending` 并退出 1：

   ```text
   ok: false
   error: QueryPending
   message: No readable diagnostic snapshot. Use --fresh to wait for current sources.
   details:
     refresh:
       code: QueryRefreshTimedOut
       …
   ```

   `QueryPending` 只表示没有可读投影，不表示没有问题。

2. 再次运行。 {#historical}

   ```sh
   concord trace gaps
   ```

   ```text
   Diagnostic snapshot: 2026-11-06T07:14:48.049Z (historical; refresh requested)
   trace gaps
   semantics: missing-explicit-relationships-not-coverage
   …
   contracts:
     docs/feature/cart/README.md — cart (feature)
   ```

   命令立即读取最近完成的投影，同时请求下一次后台刷新。人读输出先展示这是哪一时刻的历史快照、是否一致以及刷新状态。

3. 读取 JSON 中的 `projection`。 {#json}

   ```sh
   concord trace gaps --json
   ```

   ```json
   {
     "projection": {
       "current": false,
       "builtAt": "2026-11-06T07:14:50.668Z",
       "scannedAt": 1793949290571,
       "builtFrom": "2026-11-06T07:14:50.571Z",
       "builtUntil": "2026-11-06T07:14:50.620Z",
       "consistent": true,
       "complete": true,
       "changedPaths": [],
       "unknownRelations": false,
       "unknown": [],
       "refresh": "requested",
       "lastAttempt": { "scannedAt": 1793949290571, "at": "2026-11-06T07:14:50.620Z", "complete": true, "changedPaths": [] },
       "bodyChanged": []
     }
   }
   ```

   `current` 恒为 false，`consistent` 只回答构建期间观察到的来源是否保持不变。全部字段见 [CLI](../cli.md#历史投影)。

4. 在编辑过程中读取。 {#drift}

   后台扫描期间文件被改写时，投影仍会发布，但标为不一致（预期输出，时间为示例）：

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

   不一致时 `complete` 为 false、`unknownRelations` 为 true，`changedPaths` 列出变化的路径，`.` 表示范围未知。代码来源无法稳定读取时 `unknown` 为 `["code"]`，表示这类关系整体未知。

   命令仍退出 0，但 gap 列表可能偏大，零 gap 也不表示没有缺口。消费者先检查 `projection.consistent`，再使用列表。人读输出在结果前打印：

   ```text
   历史投影，构建期间来源变化（N 个路径），关系可能不完整；使用 --fresh 获取当前结果。
   ```

   已有一致投影时，它不被不一致的结果替换；此后的不一致尝试只记录在 `lastAttempt`。`lastAttempt.complete` 为 false 时，人读输出打印：

   ```text
   一致结果构建于 <builtAt>，此后的刷新在编辑中未能取得一致结果（最近 <lastAttempt.at>）。
   ```

5. 需要当前结果时加 `--fresh`。 {#fresh}

   ```sh
   concord trace gaps --fresh
   ```

   ```text
   trace gaps
   semantics: missing-explicit-relationships-not-coverage
   …
   contracts:
     docs/feature/cart/README.md — cart (feature)
   ```

   `--fresh` 使用当前来源并等待扫描结果。`--dry-run` 不启动后台刷新。没有原生产物或数据库不可用时，`--fresh` 仍通过回源执行诊断。

6. 刷新失败时查看原因。 {#refresh-error}

   最近一次刷新失败时，`projection` 附 `lastError`，以它是否存在判断最近一次刷新是否失败。还没有投影时，`QueryPending` 的 `details.refresh` 是同一个失败对象。字段与已知错误码见 [CLI](../cli.md#历史投影)。

## 结果

| 情形 | 看到什么 |
| --- | --- |
| 刷新成功 | 以事务替换完整结果 |
| 刷新失败 | 保留上一代投影；数据库可写时记录具名错误 |
| 等待同键刷新与扫描合计超过[刷新上限](../performance.md#刷新上限) | 刷新终止，`lastError.code` 为 `QueryRefreshTimedOut`，不声明刷新成功 |
| 同一查询的多个刷新请求 | 合并，只合并开始于请求之后的扫描 |
| 发布阶段数据库被占用 | 最多重试三秒；进程终止后的清理以清理宽限为界，二者不计入刷新上限 |
| 扫描消息超过 4MiB | 刷新失败，`lastError.code` 为 `QueryRefreshOutputLimit` |
| 换了 worktree、命令参数、配置字节或安装 | 不复用投影；扫描期间这些身份变化时丢弃结果，按新身份刷新，不记为失败 |
| 恢复待处理、配置无效、路径安全失败，或扫描无法形成结构 | 不发布投影 |
| 缓存严格解码失败 | 报告 `QueryCacheInvalid`，查询进程不执行全量扫描 |
| 数据库被占用 | 报告暂不可用，查询进程不执行全量扫描 |
| 前台缓存读取暂不可用 | 最多重试 500ms，每次重新核验完整路径与 Schema；仍不可读则具名报告。等待不取得发布租约，也不扫描来源 |
| 投影建成后 owner 正文摘要未变 | `trace show` 与 `review` 读取当前正文（单文件上限 32MiB）；排除 `projection` 与 `cache` 后，输出与同源 `--fresh --dry-run` 逐字节相同 |
| 投影建成后 owner 正文摘要变化 | 省略该正文，路径列入 `projection.bodyChanged` |
| 读取 owner 正文失败 | 路径列入 `projection.bodyUnavailable`，附错误码 |
| `review` 中的品味片段在投影后变化 | 输出 `(taste changed since projection; use --fresh)` |
| `cache clear` | 只删除可丢弃的投影；投影不保存 owner 正文与远端 Issue 正文 |
| 快照内条目按大小写改名 | 当前来源查询在快照结束时报 `FileChangedSinceRead`，历史投影把该条目列入变化路径 |
| 非普通文件 | 初次读取或扫描时报 `InvalidFile`，核验阶段报 `UnsafePath` |
| symlink 或越界路径 | 任何阶段都报 `UnsafePath`（[路径安全](../../local-sdlc/architecture.md#路径安全)） |

刷新、漂移分拣与替换规则的实现见[诊断投影](../architecture.md#诊断投影)，读取预算见[性能预算](../performance.md)。

### 验收方式

验收使用打包后安装到隔离 Git 仓库的 CLI，覆盖：

- 首次运行等待后台刷新并输出它发布的投影，退出 0；首次刷新失败或超时返回 `QueryPending`，`details.refresh` 为同一失败对象；`--dry-run` 首次立即返回 `QueryPending`；首次运行被中断后刷新仍完成；历史命中、刷新失败保留结果、`--fresh`、`check` 使用当前来源、并发文档写入不被扫描阻塞、进程超时和缓存清理。
- 冷缓存仓库中，后台写者在整个刷新扫描期间每隔几毫秒改写一个已观察的 docs、测试或代码文件：`trace gaps --json` 退出 0，`consistent` 为 false，`changedPaths` 含该文件，`unknownRelations` 为 true。
- 上一条的代码文件情形 `unknown` 为 `["code"]`，人读输出带不完整提示。
- 已有一致投影时下一次刷新被编辑：继续服务原投影，`lastAttempt` 记录时间、不完整与变化路径，不写 `lastError`。
- 扫描超过刷新上限：`lastError.code` 为 `QueryRefreshTimedOut` 并含 `elapsedMs` 与 `limitMs`；无投影时 `QueryPending` 的 `details.refresh` 给出同一错误。测试以短上限参数直接调用内部刷新入口，不新增用户可触发的环境变量。
- 扫描以具名错误失败（例如 `InvalidConfig`）或存在非漂移 finding：保留原错误码，非漂移 finding 记为 `TraceInvalid`；`RecoveryRequired` 不发布投影。
- 扫描期间改写 `concord.config.ts`：候选丢弃，不发布、不记为失败，按新身份重新刷新。
- 同一 worktree 的工作区投影与 trace gaps 投影在同一编辑下构建：`consistent`、`complete`、`changedPaths`、`unknownRelations`、`lastAttempt` 与替换结果一致，`builtAt` 不参与比较。
- 投影建成后修改 owner 正文：持久 payload 不含 owner 正文与远端正文字节；摘要未变时输出与同源 `--fresh --dry-run` 相同，摘要变化时出现在 `bodyChanged`。
