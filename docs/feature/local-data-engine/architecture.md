# 统一缓存与检索引擎的实现

本页声明 HawDB 的原生边界、句柄与清理所有权、工作区服务、资源预算，以及诊断投影的刷新与发布。可观察行为见 [README](README.md) 与各 Use Case。

## 原生边界

Node 通过窄 N-API 桥接调用 HawDB 公开 facade，原生例外的范围遵守 [技术栈](../../engineering/build/README.md#技术栈)。原生另提供[工作区服务](#工作区服务)服务锁的取得、校验与释放；它复用协调锁的文件检查与非阻塞加锁，属于目录所有权职责。

引擎固定为 v0.28.0，使用 fork 的 `hawdb-0.28.0` 二进制发行；revision `d47dd9b2b6a51c57a8a621367f5ff6d5d958b3e6`；桥接 ABI 为 `concord-hawdb-1`，缓存表 schema 为 1。引擎默认 features 关闭，不启用后台维护、向量或全文检索。

关系缓存使用参数化 SQL。子串查询与排序不称为 BM25 或语义检索。HawDB 不替代事实 owner、发布恢复日志或命令证据。

桥接识别 typed `HawDBError::BranchBusy` 与固定版本的旧目录锁争用，该分类贯穿 schema 与事务准入。事务获取失败保留具名错误，真正的 schema 形状错误为 `HawdbIncompatible`。

## 句柄与打开模式

持久库位于 Git-private `cache.hawdb`，各类持久缓存以命名空间隔离。持久句柄只有一个所有者（[缓存与原生边界的约束](#缓存与原生边界的约束)）：

- 该 worktree 的[工作区服务](#工作区服务)运行时，由服务长期持有。
- 没有服务时，由当前命令的最外层来源快照按需打开；嵌套调用只复用，快照结束时释放。

持久库由工作区服务创建与批量填充。首次查询等待实例就绪，后续客户端复用同一持有者。

没有服务时，只有以下操作可以创建持久库：[异步诊断投影](use-case/query-asynchronous-projections.md)的后台刷新进程、显式的 `cache rebuild`，以及保存外部观察的 `test discover`、`test run` 与 `code analyze`。其它本地操作只打开已经存在的持久库，不存在时使用本进程的内存缓存。

只读句柄需要写入时，关闭后以写模式重开，并重新竞争所有权。原生事务不跨调用逃逸。发布租约的持有者不持有持久句柄；存在独占提交时，数据库先于租约释放。

### 持久库被占用时

持久句柄可能因协调锁被占用，或发现运行中的工作区服务而不打开。这时：

- 可由当前来源完整重建的解析缓存（文档、配置、代码、测试标记与 Git 基线）改用本进程的内存缓存，命令照常完成，正确性仍由当前来源核验保证。缓存诊断保留 `HawdbBusy` 原因。
- 远端反馈快照与诊断投影不是解析缓存。服务运行时经由服务读取；没有服务而库被占用时如实报告不可用，不把空内存实例当作已读取的快照，不自动联网。
- 损坏、预算、路径安全与原生产物失败保留各自的具名失败。

`cache status`、`cache clear` 与 `cache rebuild` 有服务时由服务处理，没有服务时按本进程的持有状态报告。

### 内存实例

纯解析入口不依赖 Repository 或磁盘目录；命名空间区分数据，源摘要与解析器身份区分结果。内存实例没有文件锁，关闭或失效后可以重建。哪些解析使用内存实例见[缓存的使用与维护](#缓存的使用与维护)。

### 只读打开

配置读取、feedback 观察与 status 以 existing-only 只读方式打开。只读不写来源、不改逻辑缓存行，也不初始化表、显式 checkpoint、修复 WAL 或远端刷新。

已有完整库允许分支 runtime 挂载、内部派生文件重建和创建同级协调锁。缺目录、格式标记、根 manifest、结构性 `owner.hawdb.lock` 或表时不初始化。

已有 `branch.head` 的目录必须已有 `owner.hawdb.lock`；分支 `runtime/` 及其锁是可重建的派生文件。existing-only 打开缺失库时不创建锁或目录；可写创建可以建立已验证的数据库目录与协调锁。

### 关闭持久缓存

Repository 的只读属性 `persistentCache: 'use' | 'off'` 独立于来源访问权限，dry-run 强制为 `off`。中央 `withPersistentCache` 对关闭的读取提供 absent database，对误入的写入返回 `HawdbUnavailable`。

`cacheStatus` 在打开数据库前检查该设置。配置解析在关闭时不传缓存目录，进程内解析缓存仍可用。`checkCurrentProject`、`compileWorkspace`、LocalRepository 内全部配置 `snapshot` 调用和 query-scan worker 都遵守仓库设置与单次变更的 dry-run。

严格恢复保持启用，不启用 repair mode。有效的已提交 WAL 可由公开只读 API 读取，不授权逻辑写入。

## 协调锁

`cache.hawdb.concord.lock` 由已验证的数据库路径派生，位于同一真实父目录，协调完整句柄生命周期；它不是缓存或来源 owner。

- 锁必须是单链接普通文件，以 `O_NOFOLLOW` 不截断打开，用非阻塞 `File::try_lock` 竞争。
- 路径与描述符须指向同一 device/inode。数据库根目录身份保存并复核；根目录或协调锁被替换时拒绝操作。
- 占用、权限、I/O 与异常路径分别具名失败。

持久句柄在检查引擎目录和调用引擎前取得协调锁，持有到 schema 准入、事务、checkpoint、引擎销毁及关闭后目录检查全部结束；关闭失败也释放锁。

互斥覆盖遵守本协议的 Concord 进程（含 metadata-only 与延迟准入阶段），原生引擎锁阻止清理已持有根或分支的 HawDB 句柄。它不保证直接调用 HawDB 的程序并发创建分支，也不抵抗恶意路径替换。

该适配是对固定 revision 锁协议的显式依赖：不从 HawDBError 字符串推断，不绕过公开数据 API。

## 清理

有工作区服务时，`cache clear` 发送给服务，按以下顺序执行：

1. 服务进入 draining，等待已受理的请求完成，关闭持久句柄。
2. 异步取得独占发布租约，最多等待 3 秒；超时则重新打开并返回 `RepositoryBusy`。
3. 执行下述清理，释放租约后重新打开，并从头刷新。

服务全程持有服务锁，其它 Concord 进程不会在此期间打开持久库。没有服务时，清理在本进程执行。

### 取锁

clear 先关闭本仓库的持久句柄，再取得协调锁和根 `owner.hawdb.lock`，并按路径排序锁住树内全部以 `.lock` 结尾的普通文件，包括分支与 catalog 锁。描述符持有到清理结束。

任一锁占用、权限、I/O、路径异常或未知错误都拒绝删除。打开失败不代表可删除，损坏的 manifest 不影响独立取锁。只有显式 clear 可以为已验证目录补建根锁，不补建嵌套引擎锁。

### 删除

取锁后重新检查完整目录、锁集合与 inode，由 TypeScript 在守卫下生成删除清单。删除分三阶段：非锁文件、嵌套锁、空的嵌套目录。

- 每次删除前复核根目录、协调锁与根锁的身份，阶段边界复核剩余集合。
- selector、catalog 与 branch head 先于任何嵌套锁删除。因此延迟准入即使重建锁，也因 head 缺失而拒绝挂载。
- 已关闭的守卫不授权后续删除。

原生检查与 TypeScript 预检都不跟随 symlink，按 device/inode 汇总普通文件。每组观察到的 link count 必须一致，且等于根内不同路径数；`.lock` 文件必须单链接。

预检记录文件与目录身份、成员集合及每组剩余链接数；unlink 前要求路径身份不变，且 link count 等于剩余数。外部别名、计数或身份变化、新增或替换成员、symlink 与特殊文件均拒绝。

删除不是原子操作。部分失败返回具名失败并保留现场；后续显式 clear 重新取得守卫与清单后继续，不自动调用数据库恢复。

## 工作区服务

每个[项目目录](../../concepts.md#project-directory)最多一个工作区服务，与分支名或 worktree 的用法无关。它长期持有该目录的持久 HawDB，保持解析结果热，监听来源并刷新工作区投影，通过本机 socket 向 [Web 工作台](../web-workbench/architecture.md#工作区投影)与 CLI 提供领域结果。客户端不取得数据库句柄。

Git 适配把项目目录定位到 worktree 顶层，通过 `git rev-parse --git-path concord` 取得该目录独立的 Git-private 状态位置。普通 clone 的工作目录与 linked worktree 使用同一协议；同一目录切换分支不改变服务归属。以下以 worktree 表述这项底层隔离边界。

### 进程与资源

| 实体 | 身份 | 拥有与生命周期 |
| --- | --- | --- |
| 服务主进程 | worktree 的 Git-private 目录 + 安装身份 + 随机实例 token | 持有服务锁、持久句柄、socket、HTTP 监听与订阅；不执行领域计算 |
| 计算进程 | 由主进程经 `OwnedProcessService` 启动的长期子进程 | 持有内存解析缓存，执行前台只读查询；不打开持久库 |
| 后台计算进程 | 由主进程经 `OwnedProcessService` 启动的另一个长期子进程 | 持有自己的内存解析缓存，执行工作区投影的刷新扫描；不打开持久库 |
| 操作进程 | 每个 Web 写入、恢复或测试终结一个，经 `OwnedProcessService` 启动 | 执行 ViewAction、前像、journal 与 publication 协议；使用内存缓存，不打开持久库 |
| 服务锁 | `<privateDir>/server/lock`，原生排他文件锁，单链接普通文件，按 device/inode 校验 | 服务存活期间一直持有，清理期间也不释放；进程死亡时由操作系统释放 |
| 运行记录 | `<privateDir>/server/current.json`：`{state, pid, startedAt, token, lock, installation, protocol, socket}`，严格解码 | 只由服务锁持有者在锁内原子写入与按 token 删除 |
| socket | `<runtime>/concord-<uid>/<privateDir 的 sha256 前 32 位>.sock`，0600 | 只由服务锁持有者在锁内创建；删除前核对其 inode 与运行记录一致 |
| HTTP 监听 | `(host, port)`，每次开启返回绑定实例 token 的租约 | 按租约计数，见 [Web 工作台架构](../web-workbench/architecture.md#服务托管) |

- 服务主进程只在清理时、关闭持久库之后持有发布租约。
- 计算进程与后台计算进程无响应或超出预算时，各自整组终止并重启，缓存冷启动。无响应指既没有应答，进程组的 CPU 时间也在 60 秒内没有增长；仍在消耗 CPU 的计算不算无响应，因为同步扫描会阻塞事件循环，进程内心跳不能作为判据。单次请求的预算是 600 秒，超出时这次请求以 `ComputeRequestTimedOut` 失败，附已用时间与上限。重启后不自动重放这次请求。
- 刷新不阻塞前台查询：前台查询只排在计算进程自己的请求之后，不等待后台计算进程，也不等待刷新持有的任何锁或信号量。缓存清除等维护操作同时等两个进程空闲。
- 主进程保持一个已就绪的空闲操作进程。请求到达时交给它，它执行完这一个请求后退出；主进程确认进程组清理，再预热下一个。
- 空闲的操作进程不持有 lease、journal、来源快照或请求数据。服务进入 draining 或 stopping 时，它与其它操作进程一同回收。
- 服务锁与数据库[协调锁](#协调锁)是两把锁。
- 运行记录的 `pid` 与 `startedAt` 只用于诊断，不参与裁决。

`<runtime>` 依次取 `XDG_RUNTIME_DIR` 与 `os.tmpdir()`。目录必须属于当前 uid、权限 0700、不是符号链接，socket 路径不超过平台上限（Linux 107 字节），否则不创建服务并报告原因。

主进程把需要的持久数据（远端反馈快照、诊断投影）随请求交给计算进程，计算进程把结果交回主进程写入。持久命名空间只在主进程读写。

### 本地操作的缓存快照

CLI 的本地操作在同一实例的连接作用域内读取缓存快照，来源访问与 runner 仍在调用者进程执行。普通本地操作不因此自动启动服务。

可重建的配置、代码、测试观察与写作检查行使用和计算进程相同的派生批次 Schema，在操作成功后、输出成功结果前交回主进程。派生批次不能覆盖远端观察、历史查询或工作区投影。

传输断开或保存失败时不重跑来源操作：

- 只产出缓存的 `test discover` 与 `code analyze` 返回失败。
- 其它操作保留完成结果，并输出 `CacheUpdateFailed` 警告；来源写入结果与 journal 保持现状。

`cache-derived` 会话以随机 session 标识，按 begin、append、commit 顺序接收 UTF-8 JSON 字节。每个连接最多一个未完成会话，单批最多 32 MiB，全服务未完成数据合计最多 64 MiB。

commit 在严格解码完整批次后交给既有缓存写入校验；超限、失败或断开都释放会话。快照与派生行只对同安装、同实例及匹配命令作用域开放，客户端不接收数据库句柄。

### 远端观察的合并

远端观察由发起同步的 CLI 或操作进程取得。它完成来源发布并释放发布租约后，以 `feedback-merge` 会话把完整批次分块交给服务（begin、若干 append、commit）。

主进程逐块严格解码并累计到批量上限。commit 时对当前持久行执行单调时间戳与同版本冲突检查，在一个事务中合并并返回 warnings；未 commit 的会话随连接断开丢弃。该请求只更新可丢弃的远端观察缓存，不写来源。

服务不存在、处于降级或合并失败时，按缓存更新失败处理：来源写入结果不变，结果带 warning，不重跑来源写入。没有服务时，由本进程在释放租约后直接合并。

### 启动与裁决

CLI 查询、`concord view` 与 `concord server start` 自动启动或复用选定项目目录的服务。`concord server run` 是前台服务入口。`server status` 与 `server stop` 不启动服务。`view --in-process` 需要新服务时，以受当前命令管理的子进程启动；已有服务仍可复用。所有启动方式先取得同一服务锁。

1. 启动者读取运行记录，核对 worktree、privateDir 与安装身份，连接 socket 并发送 `hello`；应答的实例 token 必须与记录一致。
2. 没有可用服务时，启动者以 detached 方式启动 `concord server run --root <worktree>`。
3. `server run` 尝试取得服务锁。只有 WouldBlock 表示已有服务，此时进程退出，启动者回到第 1 步等待胜者。权限、I/O、类型或身份失败以具名错误 `ServerLockUnavailable` 报告。
4. 胜者在锁内删除残留 socket，绑定新 socket，写入 `state: opening` 的运行记录并开始应答 `hello`。然后打开持久库、读取最近一份已接受的结果并启动计算进程与后台计算进程，最后把记录改为 `state: running`。打开失败时进入降级状态，用内存缓存继续服务，并在状态中报告原因。
5. 启动者等待自己拉起或竞争中胜出的服务完成握手，最多 10 秒；连接已在运行的服务时握手最多 1 秒。`opening` 已可握手，项目查询等待服务就绪。

服务锁由原生绑定提供。原生产物缺失或无法加载时，同样报告 `ServerLockUnavailable`（原因 native），服务不启动；客户端报告 `WorkspaceServerUnavailable`，不在本进程执行查询。

配置无效不阻止控制接口与查询入口启动，查询返回原有配置诊断。

`hello {protocol, installation, scope?}` 返回 `{protocol, installation, token, state, sourceDigest}`；`shutdown {token, scope?}` 显式停止实例。

安装身份或协议不同时只回应控制帧。普通启动与查询返回 `WorkspaceServerVersionConflict`，不能自动停止已有实例，错误消息给出 `concord server stop`。`server stop` 用 `shutdown` 控制帧停止其它安装身份的实例。安装、升级与回退时的表现见[用一行命令安装](../cross-platform-release/use-case/install-with-script.md#upgrade-running-service)。

### 状态

| 状态 | 接受的工作 | 离开条件 |
| --- | --- | --- |
| opening | `hello`、订阅（推送 opening 状态） | 持久库打开成功进入 running，失败进入 degraded |
| running | 全部请求 | clear、维护或 shutdown 进入 draining |
| degraded | 全部请求；持久命名空间不可用，状态中给出原因 | 原生产物重新验证后重新打开；损坏需用户 clear |
| draining | 新的相关请求排队，已受理的请求完成 | 进入 clearing、maintaining 或 stopping |
| clearing / maintaining | 只读订阅与 `hello` | 成功后进入 opening；异常时进入 blocked |
| blocked | 只读订阅与 `hello`，状态给出具名原因 | 保留现场，不自动恢复或重开；用户处理后重启服务 |
| stopping | 无新请求 | 进程退出 |

- degraded 只发生在已取得服务锁之后。原因映射为 Web 的 unavailable:native 与 unavailable:corrupt。原生产物按一秒退避重新验证；安全失败不当作缓存缺失。
- clearing 或 maintaining 中出现部分删除、路径或身份异常、清理未确认时，进入 blocked。

clear、维护与 shutdown 串行执行。

服务在受理请求、绑定、发布与清理前，核对服务锁路径的 device/inode 与自身持有的一致；监听事件后与每 5 秒也核对一次。不一致时（例如 privateDir 被删除重建）进入 stopping，不再发布，只删除仍与自身 token 和 inode 一致的 socket 与记录。

### 退出

服务在三种情况下退出：无客户端连接且 10 分钟无请求；worktree 消失后 5 秒内；收到 `shutdown`。退出按以下顺序：

1. 停止受理新工作，向全部订阅者与 SSE 连接发送 `stopping` 事件，并关闭长期订阅。
2. 在 3 秒内完成或明确失败在途请求。3 秒是请求与交接的等待上限，不授权跳过清理确认。
3. 经 `OwnedProcessService` 收拢计算进程、后台计算进程与全部操作进程，确认进程组清理。
4. 关闭 HTTP 与持久句柄，按 token 删除记录与 socket，最后释放服务锁。

来源提交结果无法确认的请求返回结果未知，不透明重跑，保留 journal 与未知现场。进程组清理无法确认时按 CleanupFailed 处理。

### 刷新与推送

服务是该 worktree 唯一的工作区投影刷新者，服务内的刷新串行执行，不存在两个并发刷新。

- 监听只产生失效信号，范围与合并沿用 [Web 工作台的来源监听](../web-workbench/architecture.md#来源监听)，另外监听 Git-private 目录的 `HEAD`。
- 刷新在后台计算进程中执行，读取、漂移与替换规则沿用[读取与发布](../web-workbench/architecture.md#读取与发布)。

刷新开始时记录来源摘要，完成时重新核对当前来源。只有与计算时一致、身份不变且没有待恢复的 journal，主进程才接受这份结果：在内存中替换当前结果，并写入 `workspace_projection`，作为服务重启后的首份结果与无服务时的历史读取。核对不上的过时结果直接丢弃。

订阅、`GET /api/workspace` 与经服务的 `workspace projection` 从内存返回，不读持久库。

一份结果由它的来源摘要 `sourceDigest` 识别：参与计算的全部来源文件摘要，加上解析器与 Schema 身份的组合摘要。订阅以 `(token, sourceDigest)` 识别当前结果。

首次订阅与重连先发送完整状态。之后结果、`lastAttempt`、错误、状态与任务变化都发送事件；`sourceDigest` 与上次推送相同时不重发结果。同一连接上未发送的旧事件被新的完整状态替换，不排队。

### 协议

协议由固定版本 Effect 的 `effect/rpc` 实现：每种请求是一个 Rpc，经 `effect/socket` 在本机 socket 上传输。下文的帧、字节帧与额度是对 Rpc 消息的约束，字节帧对应 `Uint8Array` 字段。

客户端写入 socket 失败时返回 `WorkspaceServerUnavailable`，消息保留底层原因（例如 `EPIPE`），不把传输故障作为运行时 defect 逃逸。

- 客户端协议以 `RpcSerialization.layerSchemaBinary` 序列化；计算进程与后台计算进程的内部 RPC 例外，见[进程能力](../../engineering/code/architecture.md#进程能力)。
- 字节字段以原生二进制传输，不接受 Base64，由真实往返与边界大小测试验收。
- 领域 Schema 严格解码，显式拒绝未知字段。
- 单帧、累计、连接、在途与发送字节的准入由传输适配层执行；`maxBufferSize` 只限不完整消息。

数据请求带 `requestId` 与截止时间，可取消。结果按不超过 1 MiB 的块分帧，逐块准入，不预先分配声明的长度；全部块到齐并严格解码后才交给调用者。

帧分两种：JSON 帧携带结构，字节帧携带来源原文。

`read` 只返回目标与归属链各文件的原始字节（字节帧）和一个信封：路径、摘要、长度与具名诊断代码。客户端用与服务相同的共享解码函数在本地解析 frontmatter 与正文，不由服务把元数据编码进 JSON。

额度这样计算：

- 来源大小上限按原始字节判定（例如定向文件读取 32 MiB），每个文件的字节不超过来源上限；归属链长度沿用定向读取的上限。
- `read` 的信封与控制帧的 JSON 合计不超过 1 MiB。
- 领域请求与结果（例如 `feedback-merge`、`query`）的 JSON 按各自的额度累计。

请求同样可以分帧：单帧不超过 1 MiB，`feedback-merge` 的批次按批量上限（1000 条或 16 MiB）累计，以 begin、append 与 commit 分块提交，commit 原子生效。每个连接未完成的输入不超过 32 MiB。超限返回具名失败，不截断。

操作的定义、执行位置与 HTTP 对应见[服务操作](../../engineering/code/architecture.md#服务操作)，下表给出 RPC 的应答。

| 请求 | 应答 |
| --- | --- |
| `hello`、`shutdown` | 见启动与裁决 |
| `subscribe {kind: workspace}` | 完整状态，之后的事件 |
| `workspace` | 内存中已接受的结果 |
| `refresh` | 受理即应答，不等待刷新 |
| `git-status`、`git-diff {path, area}` | 当前 Git 状态与定向 diff |
| `read {path, ifUnchanged?}` | 与 Web `/api/file` 相同的定向严格读取的原始字节与信封，另附实际摘要 |
| `query {name, input, environment, cache}` | 白名单只读查询的结果或具名错误，见 CLI 查询 |
| `http {open \| close, host, port, lease?}` | 监听地址与租约 |
| `cache-clear` | 按[清理](#清理)执行后应答 |
| `cache-status`、`cache-rebuild` | 主进程读取状态，或计算派生行后由主进程保存并读取状态 |
| `cache-snapshot`、`cache-derived begin \| append \| commit` | 本地操作的只读缓存快照与派生批次；见[本地操作的缓存快照](#本地操作的缓存快照) |
| `feedback-merge begin \| append \| commit` | commit 返回合并后的 warnings；见[远端观察的合并](#远端观察的合并) |

每个服务最多 64 个连接，每个连接最多 8 个在途请求。全服务最多 256 个尚未应答的请求（含正在执行的；RPC 与 HTTP 共用这一计数），待发送字节合计不超过 64 MiB。超限按请求或连接以 `WorkspaceServerBusy` 失败，其它连接不受影响。

### CLI 查询

可经由服务的命令是固定白名单：各类 `list` 与 `show`、`trace check`、`check`、`docs check` 与 `list memory`。

每项在计算进程中以一个新的乐观 Repository 快照，执行与本进程相同的领域函数。返回前按该命令原有规则核验文件、缺失路径、目录集合、配置、路径安全、publication.revision 与恢复状态。服务只提供热的解析缓存，不提供结果。

`trace show`、`trace gaps` 与 `review` 的历史投影读取保留[异步诊断投影](use-case/query-asynchronous-projections.md)的语义，只是由服务读取投影。

CLI 默认自动启动或复用同安装身份、同协议的服务，再发送 `query`。传输断开后可以重新连接并重试一次；领域错误原样输出，不重算。

`--dry-run` 与 cache-off 调用在本进程执行同一应用查询，不启动或连接后台，也不读取或写入持久缓存，保持[打开模式](#句柄与打开模式)的无持久状态约束。写命令、交互命令、`lsp` 与外部 runner 的执行入口由各自 Feature 拥有。

原生产物缺失或摘要不符时，服务无法取得服务锁。此时查询不启动后台，与 cache-off 调用一样在本进程执行同一应用查询，源码解析回源。

- 缓存状态报告 `unavailable`，诊断与 `cache status` 相同，含产物路径、预期与实际摘要和修复安装的提示。
- 需要服务的历史诊断投影报告不可用，不当作空集合。
- `server start` 与 `server run` 返回 `HawdbUnavailable`。

查询携带本次调用的完整环境映射，最多 256 KiB；缺失变量保持缺失，不从服务启动环境补齐。计算进程为每次查询组合 Workspace，Repository 的环境读取与 adapter 输入身份使用同一映射，查询结束后释放。环境不进入运行记录、缓存、事件、诊断或日志；预热解析缓存不改变来源身份。

### 命令作用域查询

`concord --server=command check` 为本次查询启动受管后台，取得结果后先停止服务并确认进程组回收，再退出命令。已有实例时返回 `WorkspaceServerBusy`，不能附着后停止它。默认模式是 `--server=shared`。

命令作用域标识绑定规范项目根、Git-private 目录与随机能力值，通过受管进程环境传递，RPC 每次核验。

- 继承标识的同根调用只连接所属实例。
- 跨根或无效标识返回 `WorkspaceServerScopeMismatch`，所属实例失联返回 `WorkspaceServerScopeExpired`，均不启动共享后台。
- 外部 RPC 与 HTTP 监听返回 `WorkspaceServerScoped`。

继承作用域的 cache-off 查询也须核验同根与所属实例，通过既有实例执行，且不使用请求缓存；不能用 `--dry-run` 绕过作用域约束。

服务通过父子 IPC 的断开事件感知所有者退出，并执行同一停止流程；不能仅凭 PID 判断所有权。CLI 正常结束、失败与中断均关闭本次作用域。`--help`、`--version`、`--skill` 和随包资源读取不启动服务。

### 不变量

1. 一个 worktree 任一时刻最多一个工作区服务，由服务锁裁决；服务锁在清理期间也不释放。
2. Concord 进程在发现运行中的服务后，不打开该 worktree 的持久库；任一时刻最多一个打开者，由数据库协调锁保证。
3. 持有发布租约的进程不打开持久库；服务主进程只在清理时持有发布租约，且此时已关闭持久库。
4. 客户端不取得数据库句柄；经由服务的查询结果与本进程计算相同。
5. 写入、发布、恢复与证据仍由来源及 journal 决定；缓存回写失败不改变已完成的来源结果，也不重跑操作。
6. 已有服务的安装或协议冲突须先显式解决，不能绕过其缓存所有权。

| 失败 | 结果 |
| --- | --- |
| 拉起的服务 10 秒内没有完成握手 | 客户端报 `WorkspaceServerUnavailable` 并以非零码退出 |
| 已运行的服务 1 秒内没有完成握手 | 重新发现实例；不能在客户端计算 |
| 服务锁无法取得（非 WouldBlock） | `ServerLockUnavailable`，details 给出原因 |
| 运行目录不符合要求 | 不创建服务，报告原因 |
| 活跃服务的安装或协议不同 | `WorkspaceServerVersionConflict`，已有实例继续运行 |
| 计算进程超时或崩溃 | 当前请求以具名错误失败（超出预算为 `ComputeRequestTimedOut`），计算进程重启，后续请求冷启动；不把它报成 `WorkspaceServerUnavailable` |
| 后台计算进程超时或崩溃 | 这次刷新按失败记录，保留上一份结果；后台计算进程重启，下一次刷新冷启动 |
| 服务进程被杀 | 操作系统释放服务锁，下一个启动者删除残留 socket 后启动；面板与浏览器显示重连中 |

## 资源预算

预算按序列化 UTF-8 字节计入命名空间、key、source envelope 与 payload。超过上限返回具名失败或按原语义回源，不返回截断成功。

| 命名空间 | 条目上限 | 字节上限 |
| --- | ---: | ---: |
| 内存 `document_parse` | 10000 | 16 MiB |
| 内存 `code_parse` | 10000 | 16 MiB |
| 内存 `git_baseline` | 128 | 4 MiB |
| `annotation_cache` | 64 | 24 MiB |
| `code_cache` | 20000 | 32 MiB |
| `config_cache` | 128 | 8 MiB |
| `feedback_cache` | 10000 | 32 MiB |
| `query_cache` | 64 | 16 MiB |

内存 `document_parse` 中，文档占 9872 条、15 MiB，静态配置占 128 条、1 MiB。

内存总逻辑预算 36 MiB，持久总逻辑预算 96 MiB，各命名空间共享总预算。淘汰按插入顺序；自身超过预算的新批次整批拒绝。

内存实例按累计写入与删除量有界重建，避免引擎 tombstone 无限累积；重建期间新旧实例合计不超过两份逻辑预算。

静态配置解析使用独立的解析器身份。配置命中只复用严格解码的值，每次操作仍读取配置原文并执行仓库安全与协调检查。

桥接单条输入最多 8 MiB，每批最多 1000 条、16 MiB。原生查询最多 20000 行、64 MiB payload，更大的命名空间读取分批进行。关系索引读取上限 16 MiB，hydration 64 MiB。

WAL 上限为 100000 条、replay 128 MiB、单条 64 MiB、每批 50000 次操作。checkpoint encoded 256 MiB、decoded 512 MiB；segment cache 16 MiB，graph manifest 8 MiB，out-of-core delta 16 MiB。不采用上游 TiB 级默认额度，不自动修复坏 WAL。

累计 4 MiB WAL 增量或 32 个写事务后执行公开 checkpoint，失败使缓存不可用并保留现场。同批重复的 feedback identity 按输入顺序与本批已合并值比较，最后一次 putBatch 原子发布。

## 缓存的使用与维护

注解、代码、配置及远端反馈快照都存放在 HawDB 中，各类投影及其资源预算由不同的 [Cache namespace](concepts.md#cache-namespace) 区分。清理全程由 [Ownership guard](concepts.md#ownership-guard) 覆盖，取得守卫后才删除缓存数据，锁文件及其 inode 保留。

### 解析缓存

文档与静态配置解析、代码解析及不可变 Git 测试基线使用进程期的有界 HawDB 内存实例，保持容量上限、当前源字节身份与可丢弃语义，不另存解析结果 Map。

- 每篇文档每个进程最多解析一次，元数据、标题锚点、steps 与链接事实取自同一棵语法树。
- 当前源文件集合和字节每次读取。
- 配置的进程内解析命中不重新打开持久库；缓存只拥有严格解码的配置值，不拥有仓库路径验证或访问授权。

当前来源缓存严格解码，并核对原文摘要、解析器身份和 Schema，来源前后核验保留；不可用时回源或给出具名诊断。当前来源查询的临时结果只属于当前调用。

### 批量读取

集合读取采用有界批处理，按批读取和写入缓存，不为每个文件单独维护整个缓存。大批键查询使用有界命名空间扫描后选择请求的键，单键查询保持定向读取。

一个文件解析失败不丢失其它文件的结果。缓存损坏、不可用或批次超出预算时仍遵守回源行为。批处理不改变持久格式、资源所有权或清理协议。

批量写入同时遵守条数与 UTF-8 字节预算（[资源预算](#资源预算)）。没有任何测试标记候选的文本不构建 JS/TS 语法树；存在候选时仍通过注释范围校验，字符串、模板或正则中的伪标记不计为声明。

### 目录体积与维护

缓存目录的总容量与文件数量不限制打开、状态检查和清理。清理完整检查目录及链接，在 Ownership guard 内删除缓存数据并保留锁 inode；异常路径不因目录较大而跳过校验。单次输入与内存命名空间的资源边界见[资源预算](#资源预算)，与目录检查无关。

缓存目录的物理体积不设上限：缓存可以随时丢弃重建，按体积自动丢弃只会让大仓库反复冷启动；需要时由使用者运行 `concord cache clear`。写入的数据量仍受各命名空间的逻辑预算约束（[资源预算](#资源预算)）。可写使用结束时，体积按 inode 去重后超过 1 GiB 的命令，在返回前启动一个 detached 的缓存维护进程回收空间，本命令不等待。

维护进程不持有命令的句柄：

1. 以可写方式打开缓存，checkpoint 后回收不可达的引擎对象并关闭。回收不丢弃缓存数据。
2. 取不到句柄时直接退出，由下一次触发的命令再次启动。

工作区服务运行时，由服务在空闲时执行同样的回收，不另启维护进程。回收不改变任何命令结果。

- 空闲指没有在途或排队的前台请求。维护在每个阶段开始前确认空闲，有前台请求到达时先让出，前台请求不等待后台刷新完成。原生引擎的 checkpoint 与回收是一次不可中断的同步调用，期间到达的请求等它结束；回收只在体积超过 1 GiB 时发生，这段等待不另设机制规避。
- 回收只关闭并重开主进程持有的持久句柄。计算进程与后台计算进程不持有持久句柄，回收不重启它们，它们的内存解析缓存保持热。
- 回收后体积仍超过 1 GiB 时，记下回收后的体积；之后只在体积比记录再增长 256 MiB 以上时再次回收，不按固定周期重复。

### 恢复与退避

启用缓存的项目目录扫描，可以恢复固定引擎版本明确报告的只读行增量恢复失败：以 existing-only 可写句柄恢复日志并 checkpoint，再重新只读打开。

恢复不删除目录、不覆盖文档、不创建缺失的数据库。关闭缓存的模式和普通只读调用不启用该恢复，恢复失败仍报告不可用。

进程对原生产物的加载失败保留一个有界失败记录，一秒内复用该失败，随后重新验证安装产物，期间缓存调用按不可用回源。该退避只限制重复的安装检查，不跳过来源摘要、Schema 或扫描一致性验证。

## 引擎版本

缓存只对写入它的引擎、桥接 ABI 与缓存表 schema 有效。打开时任一身份不符，缓存按不可用处理；以可写方式使用时按[清理](#清理)丢弃后重建。不读取、不转换其它版本的缓存（[当前格式](../../architecture.md#当前格式)）。来源、evidence 与 journal 不在缓存中。

## 诊断投影

诊断投影只服务[异步查询](use-case/query-asynchronous-projections.md)。trace show、trace gaps 与 review 默认读取已完成的投影并请求后台刷新；还没有投影时等待这次刷新发布后再读，刷新失败或超时才返回 `QueryPending`（[首次运行](use-case/query-asynchronous-projections.md#first-run)）。

缓存命中不加载 Repository，不等待发布租约。check、trace check、Memory 与 Issue 检索、作者读取、写入、恢复与证据裁决不读取 `query_cache`；`--fresh` 与 `--dry-run` 走当前来源扫描。

### 刷新

有工作区服务时，查询刷新由服务执行，扫描仍在下述内部入口的子进程中进行，服务确认消息后写入。没有服务时，每个查询键只有一个活跃的刷新[持有者](../../concepts.md#holder) `query-refresh-worker`，已死亡的持有者可回收。

合并只控制刷新，不限制查询或文档发布。

刷新进程关闭继承的终端输入输出，在 `OwnedProcessService` 下启动内部扫描入口 `query-scan-worker <root> <query-json>`。扫描进程以只读乐观方式打开仓库，关闭持久解析缓存，在[工作区投影](../web-workbench/architecture.md#读取与发布)使用的 `repo.observeProjection(() => run(repo))` 中执行查询。

stdout 只写一条由 `src/query-scan-protocol.ts` 严格编码的消息：

```ts
type QueryScanMessage =
  | { format: 'concord.query-scan/v1'; ok: true; scannedAt: number; finishedAt: number;
      value: QueryValue; complete: boolean; unknown: 'code'[];
      drift: { files: string[]; directories: string[]; publicationChanged: boolean } }
  | { format: 'concord.query-scan/v1'; ok: false; scannedAt: number; code: string; message: string; details?: Json };
```

投影身份键由 worktree、Git-private 目录、配置字节摘要、命令参数、安装 JS 与原生产物摘要组成。

- 刷新进程在扫描前与收到消息后各计算一次身份键。两次不同时丢弃候选，不写 error 与 lastAttempt，以新键请求一次刷新。
- 旧键的排队请求在发布前重算身份时同样放弃。
- 取得租约后，若 `record.scannedAt`、`lastAttempt.scannedAt` 或 `error.scannedAt` 不早于本请求时间，请求已被满足，刷新进程直接退出。

### 漂移分拣

`run` 调用 `buildTrace` 后、`requireValidTrace` 前分拣 findings：

1. `SourceChanged` 与 `CodeSourceChanged` 是漂移 finding，path 并入 `drift.files`；path 为 `.` 表示范围未知。
2. 代码复核无法取得稳定结果时（复核读取失败、第三次读取与第二次不同或第三次读取失败），`scanCode` 返回内部标记 `relationsUnknown`，`unknown` 为 `['code']`。稳定扫描得到的空结果不是未知。
3. 其余 findings 交给 `requireValidTrace`，非空时扫描返回 `ok: false`、`code: 'TraceInvalid'`。

`complete = consistent && trace.complete`，`unknownRelations = !complete || unknown.length > 0`。

以下异常由漂移引起、无法形成结构：测试文件在读取间消失的 `SourceChanged`、trace show 的 selector 文档消失的 `DocumentNotFound`，以及 details 为 `source-observation` 的 `FileChangedSinceRead`。

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

`QueryValue` 按查询选择 `src/query-values.ts` 中 `onExcessProperty: 'error'` 的 Schema：

- `TraceGapsValue` 与当前来源的 `trace gaps --json` 相同。
- `TraceShowValue` 与 `trace show --json` 相同，但 `subject` 去掉 `body`，Issue 的 `metadata.source` 去掉远端 `body`。
- `ReviewRenderValue` 为按顺序拼接的 `{ text }` 与 `{ taste: { path, digest } }` 片段。

解码失败与身份不匹配报告 `QueryCacheInvalid`，不在前台扫描。

### 替换规则

1. 每个产出结构结果的刷新把 lastAttempt 改写为本次尝试，`at` 为扫描结束时间。
2. 非失败更新都清除旧 error。
3. 新的一致结果替换 record。
4. 新的不一致结果在已有一致 record 时保留该 record，否则替换 record。
5. 由漂移引起的无结构异常只改写 lastAttempt（`complete: false`，changedPaths 为 `['.']`）。
6. 只有失败保留 record 与 lastAttempt 并写入 error。
7. 漂移不在同一刷新内重扫。

以上规则只适用于诊断投影。它是带漂移标注的历史结果，服务 trace gaps、trace show 与 review 的历史查询；没有一致结果时也发布，并用 `consistent`、`unknownRelations` 与 `changedPaths` 如实标注，避免 agent 持续写入时查询一直拿不到结果。

工作区导航不同：它是给人看的当前项目目录，只发布一致的结果，漂移的候选丢弃，见 [Web 工作台的读取与发布](../web-workbench/architecture.md#读取与发布)。诊断投影的 `builtAt` 是发布时间，不等于 `builtUntil`。

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

当前摘要等于记录的 `subject.digest` 时填回 `body`。摘要不同或读取失败时省略 `body`，路径列入 `bodyChanged`，或附错误码列入 `bodyUnavailable`。review 对每个品味片段做同样处理。

前台只读取这些单个文件，不加载完整 Repository。`traceGaps`、`traceShow` 与 `renderReview` 各自拆出接收已分拣 trace、返回结构化值的函数，当前来源路径与历史投影共用。

## 缓存与原生边界的约束

缓存只加速，原生引擎只承担桥接（[一件事只写一次，其余推导](../../taste.md#t-3)、[技术栈](../../engineering/build/README.md#技术栈)）。

1. HawDB 只保存可重建投影与可丢弃缓存，短期解析使用同一引擎的内存实例。文件 owner、证据与发布日志不进入缓存。
2. 桥接、引擎、Rust toolchain 与依赖精确固定。锁协议与上游 revision 绑定，升级必须重新验证互斥与清理。
3. 持久句柄由明确的唯一所有者管理，来源快照不拥有跨请求句柄。客户端的逻辑会话、事务、快照与清理的生命周期分别声明，内存句柄按进程管理。
4. 缓存不参与来源发布或证据裁决。发行包携带目标平台产物，消费者不需要 Rust、全局 HawDB 或数据库服务。
5. 当前事实查询的缓存只加速：成功结果的领域事实与有效性判断必须与同源重建一致，不返回陈旧或未经校验的成功结果。
6. Spec 明确声明为历史投影的只读查询，可以返回带构建时间、来源一致性与完整性标注的结果，未知关系标为未知。该结果不表示当前来源有效，不得授权 check 成功、写入、恢复或证据裁决。投影的刷新、漂移与不可用语义由对应 Spec 拥有。
