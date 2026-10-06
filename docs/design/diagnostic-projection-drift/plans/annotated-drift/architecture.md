# 诊断投影的漂移发布

## 刷新扫描

后台刷新进程 `query-refresh-worker` 在 `OwnedProcessService` 下启动内部入口 `dist/query-scan-worker.js <root> <query-json>` 执行扫描。扫描受超时、4MiB 消息输出上限、进程组清理、刷新上限与同键合并约束。刷新上限的计时从刷新进程开始等待同键 lease 时起算。

扫描进程以只读乐观方式打开仓库，关闭持久解析缓存，在 `repo.observeProjection(() => run(repo))` 中执行查询。stdout 只写一条消息，由 `src/query-scan-protocol.ts` 的 Schema 严格编码：

```ts
type QueryScanMessage =
  | { format: 'concord.query-scan/v1'; ok: true; scannedAt: number; finishedAt: number;
      value: QueryValue; complete: boolean; unknown: 'code'[];
      drift: { files: string[]; directories: string[]; publicationChanged: boolean } }
  | { format: 'concord.query-scan/v1'; ok: false; scannedAt: number; code: string; message: string; details?: Json };
```

## 漂移分拣

`run` 先调用 `buildTrace`，再在 `requireValidTrace` 之前分拣 findings：

1. 漂移 finding：`SourceChanged`（测试来源与被引用文档的扫描内复核）与 `CodeSourceChanged`（代码来源复核）。其 path 并入 `drift.files`；path 为 `.` 时表示范围未知。
2. 关系类别未知：代码复核无法取得稳定结果而清空 codes 时，`unknown` 为 `['code']`。这包括复核读取失败、第三次读取与第二次不同、第三次读取失败三种情形，由 `scanCode` 返回的内部标记 `relationsUnknown` 判定，不从空声明推断；稳定扫描得到的空结果不是未知。测试来源复核失败时 cases 仍来自首读的完整编译，不另设未知类别；测试文件在读取间消失属于下文的无结构异常。
3. 其余 findings 保留在 trace 上，交给 `requireValidTrace`；非空时扫描以 `ok: false`、`code: 'TraceInvalid'` 返回。

完整性与工作区投影相同：`complete = consistent && trace.complete`，`unknownRelations = !complete || unknown.length > 0`。因此不一致投影一律 `complete: false`。

扫描内由漂移引起、无法形成结构的异常以 `ok: false` 返回，刷新进程按[失败分类](#失败分类)归为可重试漂移，不写 error。这类异常包括：测试文件在读取间消失时的 `SourceChanged`、trace show 的 selector 文档消失时的 `DocumentNotFound`，以及 `PreimageChanged`（details 为 `source-observation`，含配置改写后又改回、身份键不变的情形）。

## 投影身份

刷新进程在扫描前、收到扫描消息后各计算一次投影身份键（worktree、Git-private 目录、配置字节摘要、命令参数、安装 JS 与原生产物摘要）。两次不同时，不论扫描成功与否都丢弃候选，不写 error 与 lastAttempt，并以新键请求一次刷新。旧键的排队请求在发布前重算身份时同样发现键已变化，自行放弃，不重复扫描。

## 投影记录

`query_cache` 命名空间的 envelope 升级为 `concord.query-cache/v3`，旧格式读取时视为无投影（缓存可丢弃，不做转换）：

```ts
type QueryCacheEnvelope = {
  format: 'concord.query-cache/v3';
  key: string;
  record?: {
    scannedAt: number;          // 扫描开始，毫秒时间戳；同键合并依据，与 v2 含义相同
    builtFrom: string;          // scannedAt 的 ISO 表示
    builtUntil: string;         // 扫描结束
    builtAt: string;            // 发布时间，与 v2 含义相同
    consistent: boolean;
    complete: boolean;
    changedPaths: string[];     // drift.files ∪ drift.directories，publicationChanged 时并入 '.'，排序去重
    unknownRelations: boolean;  // !complete 或 unknown 非空
    unknown: 'code'[];
    value: QueryValue;
  };
  lastAttempt?: { scannedAt: number; at: string; complete: boolean; changedPaths: string[] };
  error?: { failedAt: string; scannedAt: number; code: string; message: string; elapsedMs?: number; limitMs?: number };
};
```

同键合并规则：刷新进程取得 lease 后，若 `record.scannedAt`、`lastAttempt.scannedAt` 或 `error.scannedAt` 不早于本请求时间，则请求已被满足，直接退出。

`QueryValue` 按 `context.query` 选择 Schema（envelope 不另存查询类型）：

- `TraceGapsValue`：与 `--fresh` 的 `trace gaps --json` 字段相同。
- `TraceShowValue`：与 `--fresh` 的 `trace show --json` 相同，但 `subject` 去掉 `body`；Issue 的 `metadata.source` 去掉远端 `body`。
- `ReviewRenderValue`：`{ segments: ({ text: string } | { constitution: { path: string; digest: string } })[] }`，按顺序拼接即得 Markdown 正文。

Schema 由 `src/query-values.ts` 定义，`onExcessProperty: 'error'`。解码失败与身份不匹配报告 `QueryCacheInvalid`，不在前台扫描。

## 替换规则

与[工作区投影协议](../../../workspace-projection/plans/shared-projection/PROTOCOL.md#读取与发布)一致：

1. 每个产出结构结果的刷新都把 lastAttempt 改写为本次尝试（`at` 为扫描结束时间）。
2. 所有非失败更新都清除旧 error，包括一致结果、不一致结果与可重试漂移。
3. 新的一致结果替换 record。
4. 新的不一致结果：已有一致 record 时保留该 record；没有一致 record 时替换 record。
5. 可重试漂移只改写 lastAttempt（`complete: false`，changedPaths 为 `['.']`），保留 record。
6. 只有失败保留 record 与 lastAttempt，并写入 error。
7. 漂移不在同一刷新内重扫；下一次前台读取照常请求刷新。

与工作区协议的唯一差异是 `builtAt`：工作区等于 `builtUntil`，诊断投影为兼容 v2 保留发布时间。

## 失败分类

`error.code` 是开放集合；判断刷新是否失败看 `lastError` 是否存在，不枚举码值。

刷新进程按以下顺序判断扫描结果，命中第一条即停止：

| 顺序 | 条件 | 处理 | `error.code` |
| --- | --- | --- | --- |
| 1 | 身份键前后不同 | 丢弃候选，重新请求，不写 error | — |
| 2 | 刷新上限内扫描未结束，进程被终止 | 写 error，附 `elapsedMs`、`limitMs` | `QueryRefreshTimedOut` |
| 3 | 扫描输出超过 4MiB | 写 error | `QueryRefreshOutputLimit` |
| 4 | stdout 无法解码为扫描消息 | 写 error，附 stderr 前 4096 字符 | `QueryRefreshFailed` |
| 5 | 进程异常退出：退出码非 0、被信号终止、启动错误或被取消 | 写 error，附 stderr 前 4096 字符 | `QueryRefreshFailed` |
| 6 | 进程组清理未确认 | 写 error，不发布 | `QueryRefreshCleanupUnconfirmed` |
| 7 | 扫描 `ok: false` 且为漂移引起的无结构异常 | 改写 lastAttempt（带 scannedAt），不写 error | — |
| 8 | 扫描 `ok: false` 的其它情形 | 写 error，保留扫描的码与消息 | 例如 `TraceInvalid`、`RecoveryRequired`、`InvalidConfig`、`UnsafePath` |
| 9 | 扫描 `ok: true` | 作为候选，按[替换规则](#替换规则)发布 | — |

确认清理是采用候选和处理扫描错误或漂移的前提，因此第 6 条先于第 7 至 9 条。`OwnedProcessService` 自身无法完成执行时，身份键未变则写 `QueryRefreshFailed`。

发布阶段的 HawDB 占用按现有三秒重试；仍失败时进程退出，不写记录。

## 正文边界

持久值不含 owner 正文与远端 Issue 正文。前台服务 trace show 时，对 `subject.path` 经 storage 的 `readRepositoryFileSync` 读取，检查与仓库读取相同：`canonicalPath`、仓库根内路径、`assertNoSymlink`、普通文件，以及仓库读取上限 32MiB（`MAX_BYTES`）。4MiB 是扫描消息的输出上限，不约束正文读取。读取后按 `subject.path` 严格解码 owner：

- 当前摘要等于记录的 `subject.digest`：填回 `body`，输出与同源 `--fresh` 字节相同。
- 摘要不同或读取失败：省略 `body`，路径列入 `projection.bodyChanged` 或 `projection.bodyUnavailable`（附错误码）。

review render 对每个 `constitution` 片段做同样处理；摘要不同时该片段输出 `(constitution changed since projection; use --fresh)`，并列入 `bodyChanged`。前台只读取这些单个文件，不加载完整 Repository，也不扫描。

## 授权边界

check、trace check、Memory 与 Issue 检索、作者读取、写入、恢复与证据裁决不读取 `query_cache`。`--fresh` 与 `--dry-run` 走当前来源扫描，不经过本协议。

## 验收

- C1、C2：打包后安装到隔离 Git 仓库的 CLI，后台写者在整个刷新扫描期间每隔几毫秒改写已观察的 docs、测试或代码文件，使扫描首读与复核之间必然发生变化。
- 分拣、替换规则与失败分类：`src` 级确定性测试，输入为构造的 trace findings、扫描消息与 `OwnedProcessResult`。
- C3：打包测试直接以短上限参数调用内部入口 `query-refresh-worker.js`；不新增用户环境可触发的环境变量。
- C7：检查持久 payload 不含 owner 正文与远端正文字节。摘要未变时，trace show 输出排除 `projection` 与 `cache` 后与同源 `--fresh --dry-run` 逐字节相同；review render 的 `body` 字符串与 `--fresh --dry-run` 输出的字符串相同。
- `pnpm bench query` 在 `scale` 消费者上判定刷新上限。bench 的扫描样本只证明扫描耗时；包含 lease 等待的总窗口由刷新进程按剩余期限约束扫描子进程，并由打包测试 C3 验证。
