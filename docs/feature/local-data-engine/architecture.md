# 统一缓存与检索引擎的实现

本页声明 HawDB 的原生边界、句柄与清理所有权、工作区服务、资源预算，以及诊断投影的刷新与发布。可观察行为见 [README](README.md) 与各 Use Case。

## 原生边界

Node 通过窄 N-API 桥接调用 HawDB 公开 facade，原生例外的范围遵守 [C-005](../../constitution.md#c-005-3)。原生另提供[工作区服务](#工作区服务)服务锁的取得、校验与释放，复用协调锁的文件检查与非阻塞加锁，属于目录所有权职责。引擎固定为 v0.13.0，revision `91aec4960ed27516962cf1dc918307f57faef15d`；桥接 ABI 为 `concord-hawdb-1`，缓存表 schema 为 1。引擎默认 features 关闭，不启用后台维护、向量或全文检索。关系缓存使用参数化 SQL。现有子串查询与排序不称为 BM25 或语义检索。HawDB 不替代事实 owner、发布恢复日志或命令证据（[决策依据](../../design/hawdb-data-engine/DECISION.md)）。

桥接识别 typed `HawDBError::BranchBusy` 与固定版本的旧目录锁争用，该分类贯穿 schema 与事务准入；事务获取失败保留具名错误，真正的 schema 形状错误为 `HawdbIncompatible`。

## 句柄与打开模式

持久库位于 Git-private `cache.hawdb`，各类持久缓存以命名空间隔离。持久句柄只有一个所有者（[C-005](../../constitution.md#c-005-4)）：该 worktree 的[工作区服务](#工作区服务)运行时由它长期持有；没有服务时由当前命令的最外层来源快照按需打开，嵌套调用只复用，快照结束时释放。只读句柄需要写入时，关闭后以写模式重开并重新竞争所有权。原生事务不跨调用逃逸。publication lease 的持有者不持有持久句柄，存在独占提交时数据库先于 lease 释放。

持久句柄因协调锁被占用、或发现运行中的工作区服务而不打开时，可由当前来源完整重建的解析缓存（文档、配置、代码、测试标记与 Git 基线）改用本进程的内存缓存，命令照常完成，正确性仍由当前来源核验保证。缓存诊断保留 `HawdbBusy` 原因。远端反馈快照与诊断投影不是解析缓存：服务运行时经由服务读取，没有服务而库被占用时如实报告不可用，不把空内存实例当作已读取的快照，不自动联网。损坏、预算、路径安全与原生产物失败保留各自的具名失败。`cache status`、`cache clear` 与 `cache rebuild` 如实报告占用。

文档与静态配置解析、代码解析及不可变 Git 测试基线使用进程期内存实例。纯解析入口不依赖 Repository 或磁盘目录；命名空间区分数据，源摘要与解析器身份区分代次。内存实例没有文件锁，关闭或失效后可以重建。

配置读取、feedback 观察与 status 以 existing-only 只读方式打开。只读不写来源、不改逻辑缓存行，也不初始化表、显式 checkpoint、修复 WAL 或远端刷新。已有完整库允许分支 runtime 挂载、内部派生文件重建和创建同级协调锁。缺目录、格式标记、根 manifest、结构性 `owner.hawdb.lock` 或表时不初始化。已有 `branch.head` 的目录必须已有 `owner.hawdb.lock`；分支 `runtime/` 及其锁是可重建的派生文件。existing-only 打开缺失库时不创建锁或目录；可写创建可以建立已验证的数据库目录与协调锁。

Repository 的只读属性 `persistentCache: 'use' | 'off'` 独立于来源访问权限，dry-run 强制为 `off`。中央 `withPersistentCache` 对关闭的读取提供 absent database，对误入的写入返回 `HawdbUnavailable`。`cacheStatus` 在打开数据库前检查该设置；配置解析在关闭时不传缓存目录，进程内解析缓存仍可用。`checkCurrentProject`、`compileWorkspace`、LocalRepository 内全部配置 `snapshot` 调用和 query-scan worker 都遵守仓库设置与单次变更的 dry-run。

严格恢复保持启用，不启用 repair mode。有效的已提交 WAL 可由公开只读 API 读取，不授权逻辑写入。

## 协调锁

`cache.hawdb.concord.lock` 由已验证的数据库路径派生，位于同一真实父目录，协调完整句柄生命周期；它不是缓存或来源 owner。锁必须是单链接普通文件，以 `O_NOFOLLOW` 不截断打开，用非阻塞 `File::try_lock` 竞争。路径与描述符须指向同一 device/inode，数据库根目录身份保存并复核；根目录或协调锁被替换时拒绝操作。占用、权限、I/O 与异常路径分别具名失败。

持久句柄在检查引擎目录和调用引擎前取得协调锁，持有到 schema 准入、事务、checkpoint、引擎销毁及关闭后目录检查全部结束；关闭失败也释放锁。

互斥覆盖遵守本协议的 Concord 进程（含 metadata-only 与延迟准入阶段），原生引擎锁阻止清理已持有根或分支的 HawDB 句柄。不保证直接调用 HawDB 的程序并发创建分支，也不抵抗恶意路径替换。该适配是对固定 revision 锁协议的显式依赖，不从 HawDBError 字符串推断，不绕过公开数据 API。

## 清理

有工作区服务时，`cache clear` 发送给服务：服务进入 draining，等待已受理的请求完成，关闭持久句柄，再异步取得独占 publication lease（最多等待 3 秒，超时重新打开并返回 `RepositoryBusy`），执行下述清理，释放 lease 后重新打开并从头刷新。服务全程持有服务锁，当前版本的其它进程不会在此期间打开持久库。没有服务时，清理在本进程按现行方式执行。

clear 先关闭本仓库的持久句柄，再取得协调锁和根 `owner.hawdb.lock`，并按路径排序锁住树内全部以 `.lock` 结尾的普通文件，包括分支与 catalog 锁。描述符持有到清理结束。任一锁占用、权限、I/O、路径异常或未知错误都拒绝删除；打开失败不代表可删除，损坏的 manifest 不影响独立取锁。只有显式 clear 可以为已验证目录补建根锁，不补建嵌套引擎锁。

取锁后重新检查完整目录、锁集合与 inode，由 TypeScript 在守卫下生成删除清单。删除分三阶段：非锁文件、嵌套锁、空的嵌套目录。每次删除前复核根目录、协调锁与根锁的身份，阶段边界复核剩余集合。selector、catalog 与 branch head 先于任何嵌套锁删除，因此延迟准入即使重建锁，也因 head 缺失而拒绝挂载。已关闭的守卫不授权后续删除。

原生检查与 TypeScript 预检都不跟随 symlink，按 device/inode 汇总普通文件。每组观察到的 link count 必须一致，且等于根内不同路径数；`.lock` 文件必须单链接。预检记录文件与目录身份、成员集合及每组剩余链接数；unlink 前要求路径身份不变且 link count 等于剩余数。外部别名、计数或身份变化、新增或替换成员、symlink 与特殊文件均拒绝。

删除不是原子操作。部分失败返回具名失败并保留现场，后续显式 clear 重新取得守卫与清单后继续，不自动调用数据库恢复。

## 工作区服务

每个 worktree 最多一个工作区服务。它长期持有该 worktree 的持久 HawDB，保持解析结果热，监听来源并刷新工作区投影，通过本机 socket 向 [Herdr 面板](../herdr-panel/README.md)、[Web 工作台](../web-workbench/architecture.md#工作区投影)与 CLI 提供领域结果。客户端不取得数据库句柄。HawDB 规定一个目录由一个进程长期持有，服务按此持有缓存（[决策依据](../../design/cli-hot-path/DECISION.md)）。

### 进程与资源

| 实体 | 身份 | 拥有与生命周期 |
| --- | --- | --- |
| 服务主进程 | worktree 的 Git-private 目录 + 安装身份 + 随机实例 token | 持有服务锁、持久句柄、socket、HTTP 监听与订阅；不执行领域计算；只在清理时、关闭持久库之后持有 publication lease |
| 计算进程 | 由主进程经 `OwnedProcessService` 启动的长期子进程 | 持有内存解析缓存，执行刷新扫描与只读查询；不打开持久库；60 秒无响应或超出预算时整组终止并重启，缓存冷启动 |
| 操作进程 | 每个 Web 写入、恢复或测试终结一个，经 `OwnedProcessService` 启动 | 执行现行 ViewAction、前像、journal 与 publication 协议；使用内存缓存，不打开持久库；结束后退出 |
| 服务锁 | `<privateDir>/server/lock`，原生排他文件锁，单链接普通文件，按 device/inode 校验 | 与数据库[协调锁](#协调锁)是两把锁；服务存活期间一直持有，清理期间也不释放；进程死亡时由操作系统释放 |
| 运行记录 | `<privateDir>/server/current.json`：`{state, pid, startedAt, token, lock, installation, protocol, socket}`，严格解码 | 只由服务锁持有者在锁内原子写入与按 token 删除；`pid` 与 `startedAt` 只用于诊断，不参与裁决 |
| socket | `<runtime>/concord-<uid>/<privateDir 的 sha256 前 32 位>.sock`，0600；Windows 为同名 named pipe | 只由服务锁持有者在锁内创建；删除前核对其 inode 与运行记录一致 |
| HTTP 监听 | `(host, port)`，每次开启返回绑定实例 token 的租约 | 按租约计数，见 [Web 工作台架构](../web-workbench/architecture.md#服务托管) |

`<runtime>` 依次取 `XDG_RUNTIME_DIR` 与 `os.tmpdir()`。目录必须属于当前 uid、权限 0700、不是符号链接，socket 路径不超过平台上限（Linux 107 字节），否则不创建服务并报告原因。

主进程把需要的持久数据（远端反馈快照、诊断投影）随请求交给计算进程，计算进程把结果交回主进程写入；持久命名空间只在主进程读写。

远端观察由发起同步的 CLI 或操作进程取得。它完成来源发布并释放 publication lease 后，以 `feedback-merge` 会话把完整批次分块交给服务（begin、若干 append、commit）。主进程逐块严格解码并累计到批量上限，在 commit 时对当前持久行执行现行的单调时间戳与同版本冲突检查，在一个事务中合并并返回 warnings；未 commit 的会话随连接断开丢弃。该请求只更新可丢弃的远端观察缓存，不写来源。服务不存在、处于降级或合并失败时，按现行缓存更新失败处理：来源回执不变，结果带 warning，不重跑来源写入。没有服务时仍由本进程在释放 lease 后直接合并。

### 启动与裁决

只有 `concord panel`、`concord view` 与 `concord server start` 启动服务；其它 CLI 命令只使用已有服务。`view --in-process` 在本进程运行同一服务，同样先取得服务锁。

1. 启动者读取运行记录，核对 worktree、privateDir 与安装身份，连接 socket 并发送 `hello`；应答的实例 token 必须与记录一致。
2. 没有可用服务时，启动者以 detached 方式启动 `concord server run --root <worktree>`。
3. `server run` 尝试取得服务锁。只有 WouldBlock 表示已有服务，此时进程退出，启动者回到第 1 步等待胜者；权限、I/O、类型或身份失败分别以具名错误 `ServerLockUnavailable` 报告。
4. 胜者在锁内删除残留 socket，绑定新 socket，写入 `state: opening` 的运行记录并开始应答 `hello`，然后打开持久库、读取已有代次并启动计算进程，最后把记录改为 `state: running`。打开失败时进入降级状态，用内存缓存继续服务并在状态中报告原因。
5. 启动者等待可握手的服务最多 1 秒；`opening` 已可握手，不必等待打开持久库。

`hello` 与 `shutdown` 是控制帧，结构由本页固定：`hello {protocol, installation}` 返回 `{protocol, installation, token, state, generation}`；安装身份或协议不同时只回应这两种控制帧。启动者遇到不同身份的服务时发送带对方 token 的 `shutdown`，等待其释放服务锁（上限 3 秒），超时返回 `WorkspaceServerBusy` 并在 details 中给出对方 pid 与安装身份。CLI 只读命令遇到不同身份的服务时在本进程计算，不接管。

### 状态

| 状态 | 接受的工作 | 离开条件 |
| --- | --- | --- |
| opening | `hello`、订阅（推送 opening 状态） | 持久库打开成功进入 running，失败进入 degraded |
| running | 全部请求 | clear、维护或 shutdown 进入 draining |
| degraded | 全部请求；持久命名空间不可用，状态中给出原因，按原因映射 Web 的 unavailable:native 与 unavailable:corrupt | 原生产物按现行一秒退避重新验证后重新打开；损坏需用户 clear；安全失败不当作缓存缺失 |
| draining | 新的相关请求排队，已受理的请求完成 | 进入 clearing、maintaining 或 stopping |
| clearing / maintaining | 只读订阅与 `hello` | 成功后进入 opening；部分删除、路径或身份异常、清理未确认时进入 blocked |
| blocked | 只读订阅与 `hello`，状态给出具名原因 | 保留现场，不自动恢复或重开；用户处理后重启服务 |
| stopping | 无新请求 | 进程退出 |

clear、维护与 shutdown 串行执行。服务在受理请求、绑定、发布与清理前核对服务锁路径的 device/inode 与自身持有的一致，监听事件后与每 5 秒也核对一次；不一致（例如 privateDir 被删除重建）时进入 stopping，不再发布，只删除仍与自身 token 和 inode 一致的 socket 与记录。

服务在无客户端连接且 10 分钟无请求后退出；worktree 消失时 5 秒内退出；收到 `shutdown` 时退出。退出先停止受理新工作，向全部订阅者与 SSE 连接发送 `stopping` 事件并关闭长期订阅，再在 3 秒内完成或明确失败在途请求。随后经 `OwnedProcessService` 收拢计算进程与全部操作进程，确认进程组清理，关闭 HTTP 与持久句柄，按 token 删除记录与 socket，最后释放服务锁。3 秒是请求与交接的等待上限，不授权跳过清理确认。来源提交结果无法确认的请求返回结果未知，不透明重跑，保留 journal 与未知现场；进程组清理无法确认时按 CleanupFailed 处理。

### 刷新与推送

服务是该 worktree 唯一的工作区投影刷新者。监听只产生失效信号，范围与合并沿用 [Web 工作台的来源监听](../web-workbench/architecture.md#来源监听)，另外监听 Git-private 目录的 `HEAD`。刷新在计算进程中执行，读取、漂移与替换规则沿用[读取与发布](../web-workbench/architecture.md#读取与发布)；主进程确认结果、身份与无待恢复 journal 后接受该代次：在内存中替换当前代次，并写入 `workspace_projection` 作为服务重启后的首个代次与无服务时的历史读取。订阅、`GET /api/workspace` 与经服务的 `workspace projection` 从内存返回，不读持久库（[决策依据](../../design/workspace-runtime/DECISION.md)）。

订阅以 `(token, generation)` 识别代次。首次订阅与重连先发送完整状态；之后代次、`lastAttempt`、错误、状态与任务变化都发送事件，即使没有新代次。同一连接上未发送的旧事件被新的完整状态替换，不排队。

### 协议

协议由固定版本 Effect 的 `unstable/rpc` 实现：每种请求是一个 Rpc，经 `unstable/socket` 在本机 socket 上传输，以 `RpcSerialization.layerSchemaBinary` 序列化，字节字段原生二进制传输，Schema 严格解码，未知字段拒绝。下文的帧、字节帧与额度是对 Rpc 消息的约束，字节帧对应 `Uint8Array` 字段。数据请求带 `requestId` 与截止时间，可取消；结果按不超过 1 MiB 的块分帧，逐块准入，不预先分配声明的长度；全部块到齐并严格解码后才交给调用者。

帧分两种：JSON 帧携带结构，字节帧携带来源原文。`read` 只返回目标与归属链各文件的原始字节（字节帧）和一个信封：路径、摘要、长度与具名诊断代码；客户端用与服务相同的共享解码函数在本地解析 frontmatter 与正文，不由服务把元数据编码进 JSON。来源大小上限按原始字节判定（例如定向文件读取 32 MiB），每个文件的字节不超过来源上限，归属链长度沿用定向读取的现行上限；`read` 的信封与控制帧的 JSON 合计不超过 1 MiB；领域请求与结果（例如 `feedback-merge`、`query`）的 JSON 按各自下文与现行的额度累计。

请求同样可以分帧：单帧不超过 1 MiB，`feedback-merge` 的批次按现行批量上限（1000 条或 16 MiB）累计；每个连接未完成的输入不超过 32 MiB。超限返回具名失败，不截断。

操作的定义、执行位置与 HTTP 对应见[服务操作](../../architecture.md#服务操作)，下表给出 RPC 的应答。

| 请求 | 应答 |
| --- | --- |
| `hello`、`shutdown` | 见启动与裁决 |
| `subscribe {kind: workspace}` | 完整状态，之后的事件 |
| `workspace` | 内存中已接受的代次 |
| `refresh` | 受理即应答，不等待刷新 |
| `git-status`、`git-diff {path, area}` | 当前 Git 状态与定向 diff |
| `read {path, expectedDigest?}` | 与 Web `/api/file` 相同的定向严格读取的原始字节与信封，另附实际摘要 |
| `query {name, input}` | 白名单只读查询的结果或具名错误，见 CLI 查询 |
| `http {open \| close, host, port, lease?}` | 监听地址与租约 |
| `cache-clear` | 按[清理](#清理)执行后应答 |
| `feedback-merge begin \| append \| commit` | commit 返回合并后的 warnings；见进程与资源 |

每个服务最多 64 个连接，每个连接最多 8 个在途请求，全服务最多 256 个排队请求，待发送字节合计不超过 64 MiB；超限按请求或连接以 `WorkspaceServerBusy` 失败，其它连接不受影响。

### CLI 查询

可经由服务的命令是固定白名单：各类 `list` 与 `show`、`trace check`、`check`、`docs check` 与 `memory index`。每项在计算进程中以一个新的乐观 Repository 快照执行与本进程相同的领域函数，返回前按该命令原有规则核验文件、缺失路径、目录集合、配置、路径安全、publication.revision 与恢复状态；服务只提供热的解析缓存，不提供结果。`trace show`、`trace gaps` 与 `review render` 的历史投影读取保留[异步诊断投影](use-case/query-asynchronous-projections.md)的语义，只是由服务读取投影。

CLI 有同安装身份的服务时发送 `query`，否则在本进程计算，`--dry-run` 不连接服务。查询在应答前断开时，CLI 以相同输入在本进程重新计算；服务已返回的领域错误原样输出，不重算。写命令、交互命令、`view`、`lsp` 与外部 runner 不经由服务。

### 不变量

1. 一个 worktree 任一时刻最多一个工作区服务，由服务锁裁决；服务锁在清理期间也不释放。
2. 当前版本的 Concord 进程在发现运行中的服务后不打开该 worktree 的持久库；任一时刻最多一个打开者由数据库协调锁保证。
3. 持有 publication lease 的进程不打开持久库；服务主进程只在清理时持有 publication lease，且此时已关闭持久库。
4. 客户端不取得数据库句柄；经由服务的查询结果与本进程计算相同。
5. 写入、发布、恢复与证据不依赖服务：服务不存在、崩溃或版本不同时，同一命令得到相同结果。

| 失败 | 结果 |
| --- | --- |
| 1 秒内没有可握手的服务 | 面板与 `view` 报 `WorkspaceServerUnavailable` 并以非零码退出；CLI 在本进程计算 |
| 服务锁无法取得（非 WouldBlock） | `ServerLockUnavailable`，details 给出原因 |
| 运行目录不符合要求 | 不创建服务，报告原因 |
| 不同身份的服务 3 秒内未退出 | `WorkspaceServerBusy`，details 给出对方 pid 与安装身份 |
| 计算进程超时或崩溃 | 当前请求以具名错误失败，计算进程重启，后续请求冷启动 |
| 服务进程被杀 | 操作系统释放服务锁，下一个启动者删除残留 socket 后启动；面板与浏览器显示重连中 |

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

## 引擎版本

缓存只对写入它的引擎、桥接 ABI 与缓存表 schema 有效。打开时任一身份不符，缓存按不可用处理，以可写方式使用时按[清理](#清理)丢弃后重建；不读取、不转换其它版本的缓存（[C-009](../../constitution.md#c-009-2)）。来源、evidence 与 journal 不在缓存中。

## 诊断投影

诊断投影只服务[异步查询](use-case/query-asynchronous-projections.md)（[决策依据](../../design/asynchronous-projections/DECISION.md)、[漂移发布依据](../../design/diagnostic-projection-drift/DECISION.md)）。缓存命中不加载 Repository，不等待 publication lease。check、trace check、Memory 与 Issue 检索、作者读取、写入、恢复与证据裁决不读取 `query_cache`；`--fresh` 与 `--dry-run` 走当前来源扫描。

### 刷新

有工作区服务时，查询刷新由服务执行，扫描仍在下述内部入口的子进程中进行，服务确认消息后写入。没有服务时，每个查询键只有一个活跃刷新 owner `query-refresh-worker`，死亡 owner 可回收。

合并只控制刷新，不限制查询或文档发布。刷新进程关闭继承的终端输入输出，在 `OwnedProcessService` 下启动内部入口 `dist/query-scan-worker.js <root> <query-json>`。扫描进程以只读乐观方式打开仓库，关闭持久解析缓存，在[工作区投影](../web-workbench/architecture.md#读取与发布)使用的 `repo.observeProjection(() => run(repo))` 中执行查询。stdout 只写一条由 `src/query-scan-protocol.ts` 严格编码的消息：

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

`query_cache` 的 envelope 为 `concord.query-cache/v3`，其它 envelope 视为无投影：

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
