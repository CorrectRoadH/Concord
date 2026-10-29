# 统一缓存与检索引擎的实现

本页声明 HawDB 的原生边界、句柄与清理所有权、资源预算，以及诊断投影的刷新与发布。可观察行为见 [README](README.md) 与各 Use Case。

## 原生边界

Node 通过窄 N-API 桥接调用 HawDB 公开 facade，原生例外的范围遵守 [C-005](../../constitution.md#c-005-3)。引擎固定为 v0.13.0，revision `91aec4960ed27516962cf1dc918307f57faef15d`；桥接 ABI 为 `concord-hawdb-1`，缓存表 schema 为 1。引擎默认 features 关闭，不启用后台维护、向量或全文检索。关系缓存使用参数化 SQL。现有子串查询与排序不称为 BM25 或语义检索。HawDB 不替代事实 owner、发布恢复日志或命令证据（[决策依据](../../design/hawdb-data-engine/DECISION.md)）。

桥接识别 typed `HawDBError::BranchBusy` 与固定版本的旧目录锁争用，该分类贯穿 schema 与事务准入；事务获取失败保留具名错误，真正的 schema 形状错误为 `HawdbIncompatible`。

## 句柄与打开模式

持久库位于 Git-private `cache.hawdb`，各类持久缓存以命名空间隔离。最外层来源快照按需打开并拥有持久句柄，嵌套调用只复用。只读句柄需要写入时，关闭后以写模式重开并重新竞争所有权。原生事务不跨调用逃逸。持久句柄在来源快照结束时释放，不跨网络请求或 Web 空闲时间持有；存在独占提交时，数据库先于 publication lease 释放。

文档与静态配置解析、代码解析及不可变 Git 测试基线使用进程期内存实例。纯解析入口不依赖 Repository 或磁盘目录；命名空间区分数据，源摘要与解析器身份区分代次。内存实例没有文件锁，关闭或失效后可以重建。

配置读取、feedback 观察与 status 以 existing-only 只读方式打开。只读不写来源、不改逻辑缓存行，也不初始化表、显式 checkpoint、修复 WAL 或远端刷新。已有完整库允许分支 runtime 挂载、内部派生文件重建和创建同级协调锁。缺目录、格式标记、根 manifest、结构性 `owner.hawdb.lock` 或表时不初始化。已有 `branch.head` 的目录必须已有 `owner.hawdb.lock`；分支 `runtime/` 及其锁是可重建的派生文件。existing-only 打开缺失库时不创建锁或目录；可写创建可以建立已验证的数据库目录与协调锁。

Repository 的只读属性 `persistentCache: 'use' | 'off'` 独立于来源访问权限，dry-run 强制为 `off`。中央 `withPersistentCache` 对关闭的读取提供 absent database，对误入的写入返回 `HawdbUnavailable`。`cacheStatus` 在打开数据库前检查该设置；配置解析在关闭时不传缓存目录，进程内解析缓存仍可用。`checkCurrentProject`、`compileWorkspace`、LocalRepository 内全部配置 `snapshot` 调用和 query-scan worker 都遵守仓库设置与单次变更的 dry-run。

严格恢复保持启用，不启用 repair mode。有效的已提交 WAL 可由公开只读 API 读取，不授权逻辑写入。

## 协调锁

`cache.hawdb.concord.lock` 由已验证的数据库路径派生，位于同一真实父目录，协调完整句柄生命周期；它不是缓存或来源 owner。锁必须是单链接普通文件，以 `O_NOFOLLOW` 不截断打开，用非阻塞 `File::try_lock` 竞争。路径与描述符须指向同一 device/inode，数据库根目录身份保存并复核；根目录或协调锁被替换时拒绝操作。占用、权限、I/O 与异常路径分别具名失败。

持久句柄在检查引擎目录和调用引擎前取得协调锁，持有到 schema 准入、事务、checkpoint、引擎销毁及关闭后目录检查全部结束；关闭失败也释放锁。

互斥覆盖遵守本协议的 Concord 进程（含 metadata-only 与延迟准入阶段），原生引擎锁阻止清理已持有根或分支的 HawDB 句柄。不保证直接调用 HawDB 的程序并发创建分支，也不抵抗恶意路径替换。该适配是对固定 revision 锁协议的显式依赖，不从 HawDBError 字符串推断，不绕过公开数据 API。

## 清理

clear 先关闭本仓库的持久句柄，再取得协调锁和根 `owner.hawdb.lock`，并按路径排序锁住树内全部以 `.lock` 结尾的普通文件，包括分支与 catalog 锁。描述符持有到清理结束。任一锁占用、权限、I/O、路径异常或未知错误都拒绝删除；打开失败不代表可删除，损坏的 manifest 不影响独立取锁。只有显式 clear 可以为已验证目录补建根锁，不补建嵌套引擎锁。

取锁后重新检查完整目录、锁集合与 inode，由 TypeScript 在守卫下生成删除清单。删除分三阶段：非锁文件、嵌套锁、空的嵌套目录。每次删除前复核根目录、协调锁与根锁的身份，阶段边界复核剩余集合。selector、catalog 与 branch head 先于任何嵌套锁删除，因此延迟准入即使重建锁，也因 head 缺失而拒绝挂载。已关闭的守卫不授权后续删除。

原生检查与 TypeScript 预检都不跟随 symlink，按 device/inode 汇总普通文件。每组观察到的 link count 必须一致，且等于根内不同路径数；`.lock` 文件必须单链接。预检记录文件与目录身份、成员集合及每组剩余链接数；unlink 前要求路径身份不变且 link count 等于剩余数。外部别名、计数或身份变化、新增或替换成员、symlink 与特殊文件均拒绝。

删除不是原子操作。部分失败返回具名失败并保留现场，后续显式 clear 重新取得守卫与清单后继续，不自动调用数据库恢复。

## 资源预算

预算按序列化 UTF-8 字节计入命名空间、key、source envelope 与 payload。超过上限返回具名失败或按原语义回源，不返回截断成功。

| 命名空间 | 条目上限 | 字节上限 |
| --- | ---: | ---: |
| 内存 `document_parse`（文档 9872 条、15 MiB；静态配置 128 条、1 MiB） | 10000 | 16 MiB |
| 内存 `code_parse` | 10000 | 16 MiB |
| 内存 `git_baseline` | 128 | 4 MiB |
| `annotation_cache` | 64 | 24 MiB |
| `code_cache` | 20000 | 32 MiB |
| `config_cache` | 128 | 8 MiB |
| `feedback_cache` | 10000 | 32 MiB |
| `query_cache` | 64 | 16 MiB |

内存总逻辑预算 36 MiB，持久总逻辑预算 96 MiB，各命名空间共享总预算。淘汰按插入顺序；自身超过预算的新批次整批拒绝。内存实例按累计写入与删除量有界重建，避免引擎 tombstone 无限累积，重建期间新旧实例合计不超过两份逻辑预算。静态配置解析使用独立的解析器身份；配置命中只复用严格解码的值，每次操作仍读取配置原文并执行仓库安全与协调检查。

桥接单条输入最多 8 MiB，每批最多 1000 条、16 MiB。原生查询最多 20000 行、64 MiB payload，更大的命名空间读取分批进行。关系索引读取上限 16 MiB，hydration 64 MiB。WAL 上限为 100000 条、replay 128 MiB、单条 64 MiB、每批 50000 次操作。checkpoint encoded 256 MiB、decoded 512 MiB；segment cache 16 MiB，graph manifest 8 MiB，out-of-core delta 16 MiB。不采用上游 TiB 级默认额度，不自动修复坏 WAL。

累计 4 MiB WAL 增量或 32 个写事务后执行公开 checkpoint，失败使缓存不可用并保留现场。同批重复的 feedback identity 按输入顺序与本批已合并值比较，最后一次 putBatch 原子发布。

## 升级

公开可写打开在协调锁内把有效的 v0.3 缓存接入分支项目格式，保留既有表与远端观察；来源、evidence 与 journal 不迁移。不增加兼容解析器、旧运行时或自动破坏性回退。0.13.0 之前的桥接拒绝内部硬链接，降级步骤见[统一缓存](use-case/use-unified-cache.md)。发行说明列明读取时的派生文件行为、混用限制与降级步骤。

## 诊断投影

诊断投影只服务[异步查询](use-case/query-asynchronous-projections.md)（[决策依据](../../design/asynchronous-projections/DECISION.md)、[漂移发布依据](../../design/diagnostic-projection-drift/DECISION.md)）。缓存命中不加载 Repository，不等待 publication lease。check、trace check、Memory 与 Issue 检索、作者读取、写入、恢复与证据裁决不读取 `query_cache`；`--fresh` 与 `--dry-run` 走当前来源扫描。

### 刷新

每个查询键只有一个活跃刷新 owner `query-refresh-worker`，死亡 owner 可回收；合并只控制刷新，不限制查询或文档发布。刷新进程关闭继承的终端输入输出，在 `OwnedProcessService` 下启动内部入口 `dist/query-scan-worker.js <root> <query-json>`。扫描进程以只读乐观方式打开仓库，关闭持久解析缓存，在[工作区投影](../web-workbench/architecture.md#读取与发布)使用的 `repo.observeProjection(() => run(repo))` 中执行查询。stdout 只写一条由 `src/query-scan-protocol.ts` 严格编码的消息：

```ts
type QueryScanMessage =
  | { format: 'concord.query-scan/v1'; ok: true; scannedAt: number; finishedAt: number;
      value: QueryValue; complete: boolean; unknown: 'code'[];
      drift: { files: string[]; directories: string[]; publicationChanged: boolean } }
  | { format: 'concord.query-scan/v1'; ok: false; scannedAt: number; code: string; message: string; details?: Json };
```

投影身份键由 worktree、Git-private 目录、配置字节摘要、命令参数、安装 JS 与原生产物摘要组成。刷新进程在扫描前与收到消息后各计算一次；两次不同时丢弃候选，不写 error 与 lastAttempt，以新键请求一次刷新。旧键的排队请求在发布前重算身份时同样放弃。取得 lease 后，若 `record.scannedAt`、`lastAttempt.scannedAt` 或 `error.scannedAt` 不早于本请求时间，请求已被满足，刷新进程直接退出。

### 漂移分拣

`run` 调用 `buildTrace` 后、`requireValidTrace` 前分拣 findings：

1. `SourceChanged` 与 `CodeSourceChanged` 是漂移 finding，path 并入 `drift.files`；path 为 `.` 表示范围未知。
2. 代码复核无法取得稳定结果时（复核读取失败、第三次读取与第二次不同或第三次读取失败），`scanCode` 返回内部标记 `relationsUnknown`，`unknown` 为 `['code']`。稳定扫描得到的空结果不是未知。
3. 其余 findings 交给 `requireValidTrace`，非空时扫描返回 `ok: false`、`code: 'TraceInvalid'`。

`complete = consistent && trace.complete`，`unknownRelations = !complete || unknown.length > 0`。测试文件在读取间消失的 `SourceChanged`、trace show 的 selector 文档消失的 `DocumentNotFound`，以及 details 为 `source-observation` 的 `PreimageChanged`，属于由漂移引起、无法形成结构的异常。

### 投影记录

`query_cache` 的 envelope 为 `concord.query-cache/v3`，旧格式读取时视为无投影：

```ts
type QueryCacheEnvelope = {
  format: 'concord.query-cache/v3';
  key: string;
  record?: {
    scannedAt: number; builtFrom: string; builtUntil: string; builtAt: string;
    consistent: boolean; complete: boolean;
    changedPaths: string[];     // drift.files ∪ drift.directories，publicationChanged 时并入 '.'，排序去重
    unknownRelations: boolean; unknown: 'code'[]; value: QueryValue;
  };
  lastAttempt?: { scannedAt: number; at: string; complete: boolean; changedPaths: string[] };
  error?: { failedAt: string; scannedAt: number; code: string; message: string; elapsedMs?: number; limitMs?: number };
};
```

`scannedAt` 是扫描开始的毫秒时间戳，`builtFrom` 是其 ISO 表示，`builtUntil` 是扫描结束，`builtAt` 是发布时间。

`QueryValue` 按查询选择 `src/query-values.ts` 中 `onExcessProperty: 'error'` 的 Schema。`TraceGapsValue` 与当前来源的 `trace gaps --json` 相同。`TraceShowValue` 与 `trace show --json` 相同，但 `subject` 去掉 `body`，Issue 的 `metadata.source` 去掉远端 `body`。`ReviewRenderValue` 为按顺序拼接的 `{ text }` 与 `{ constitution: { path, digest } }` 片段。解码失败与身份不匹配报告 `QueryCacheInvalid`，不在前台扫描。

### 替换规则

1. 每个产出结构结果的刷新把 lastAttempt 改写为本次尝试，`at` 为扫描结束时间。
2. 非失败更新都清除旧 error。
3. 新的一致结果替换 record。
4. 新的不一致结果在已有一致 record 时保留该 record，否则替换 record。
5. 由漂移引起的无结构异常只改写 lastAttempt（`complete: false`，changedPaths 为 `['.']`）。
6. 只有失败保留 record 与 lastAttempt 并写入 error。
7. 漂移不在同一刷新内重扫。

工作区投影采用相同语义；诊断投影的 `builtAt` 是发布时间，不等于 `builtUntil`。

### 失败分类

`error.code` 是开放集合。刷新进程按顺序判断，命中第一条即停止：

| 顺序 | 条件 | 处理 | `error.code` |
| --- | --- | --- | --- |
| 1 | 身份键前后不同 | 丢弃候选并重新请求 | — |
| 2 | 刷新上限内扫描未结束，进程被终止 | 写 error，附 `elapsedMs`、`limitMs` | `QueryRefreshTimedOut` |
| 3 | 扫描输出超过 4 MiB | 写 error | `QueryRefreshOutputLimit` |
| 4 | stdout 无法解码为扫描消息 | 写 error，附 stderr 前 4096 字符 | `QueryRefreshFailed` |
| 5 | 退出码非 0、被信号终止、启动错误或被取消 | 写 error，附 stderr 前 4096 字符 | `QueryRefreshFailed` |
| 6 | 进程组清理未确认 | 写 error，不发布 | `QueryRefreshCleanupUnconfirmed` |
| 7 | 由漂移引起的无结构异常 | 改写 lastAttempt，不写 error | — |
| 8 | 其它 `ok: false` | 写 error，保留扫描的码与消息 | 例如 `TraceInvalid`、`RecoveryRequired`、`InvalidConfig`、`UnsafePath` |
| 9 | `ok: true` | 按替换规则发布 | — |

`OwnedProcessService` 自身无法完成执行且身份键未变时写 `QueryRefreshFailed`。发布阶段的 HawDB 占用按三秒重试，仍失败时进程退出，不写记录。

### 正文边界

持久值不含 owner 正文与远端 Issue 正文。trace show 服务时经 storage 的 `readRepositoryFileSync` 读取 `subject.path`，执行[路径安全](../local-sdlc/architecture.md#路径安全)、普通文件与 32 MiB（`MAX_BYTES`）检查，再按路径严格解码 owner。

当前摘要等于记录的 `subject.digest` 时填回 `body`；摘要不同或读取失败时省略 `body`，路径列入 `bodyChanged` 或附错误码列入 `bodyUnavailable`。review render 对每个宪法片段做同样处理。前台只读取这些单个文件，不加载完整 Repository。`traceGaps`、`traceShow` 与 `renderReview` 各自拆出接收已分拣 trace、返回结构化值的函数，当前来源路径与历史投影共用。
