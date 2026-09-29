# 工作区投影协议

## 读取与发布

`LocalRepository.observeProjection(read)` 是仅供工作区展示刷新使用的读取原语。

它沿用 `snapshot()` 的开始、路径安全、Schema 解码、观察记录与句柄关闭。

读取函数返回后收集文件内容和目录集合差异，返回 `{ value, drift: { files: string[], directories: string[], publicationChanged: boolean } }`。

文件、目录与 publication revision 漂移不抛错。

前后均确认没有待恢复 journal，revision 单独变化标为 publicationChanged，未知影响范围用 changedPaths 的仓库根目录 `.` 表示。

配置变化、RecoveryRequired、路径安全失败和无可用结构的编译异常仍具名抛错，候选被丢弃。

现有 `snapshot()`、`verifySnapshot()`、当前 CLI、check、写入和证据路径保持原语义。

刷新开始与写入前都重新计算身份键，不一致时丢弃候选。

文件内容、目录集合或无待恢复 journal 的 publication revision 漂移可发布 `consistent:false`、`complete:false` 的结构代次。

`consistent` 仅表示构建期间来源无漂移。

`complete` 保留现有扫描完整性及 findings 语义，两者不可混用。

`changedPaths` 是排序去重的文件或目录路径，`unknownRelations:true`。

所有缺失关系、零 finding 和健康结论都显示为未知，不显示“无问题”。

已有 `buildTrace` catch 分支在能形成安全结构及具名 finding 时可形成不完整代次。

无结构结果时拒绝发布。

无漂移但有 finding 同样 `complete:false`，保留实际诊断，不称为健康。

一次刷新最多 60 秒，不因漂移重新扫描。

首次即可发布不完整结构。

已有 consistent:true 代次不被 consistent:false 代次替换，最近尝试只附时间、变化路径和状态。

新的 consistent:true 代次即使存在 finding，也必须替换旧代次。

无 consistent:true 代次时，较新的不一致导航可替换较旧的不一致导航。

配置变更使键变化，旧配置代次不跨身份展示，新身份显示构建中。

## 持久模型

`WorkspaceProjectionRecord` 是独立 `workspace_projection` 命名空间唯一的一条记录，物理 key 固定为 `workspace`。

payload 格式 `concord.workspace-projection/v1`，含逻辑 `identity`、可选 `record`、`lastAttempt`、`error`。

record 包含 `builtAt`、`builtFrom`、`builtUntil`、`consistent`、`complete`、`changedPaths`、`unknownRelations` 和结构 `snapshot`。

lastAttempt 只含时间、完整性与变化路径，不保存第二份快照。

error 含 `failedAt`、具名 `code` 和至多 4096 字符的 `message`。

一次 HawDB put 原子替换固定行。

新逻辑身份覆盖旧行，不积累配置或安装版本的旧键。

前台不服务损坏记录。

writer 可以用新完整记录覆盖坏 payload。

逻辑 identity 由 worktree root、Git-private directory、配置文件原文字节摘要、安装目录全部 JS 与 native artifact 摘要和固定的 workspace 类型组成。

启动前先验证原生模块。

缺原生模块是 unavailable，不把它误判为尚无代次。

持久 snapshot 的字段白名单如下。

- root、规范化 project、configDigest。
- documents 的 path/metadata/digest。
- pages 的 path/documentPath/digest/derivedTitle。
- feedback 的 document:WorkspaceDocument、provider、triage、availability、warnings 与去掉 body 的 remote（身份、标题、URL、状态、时间）。
- cases、codes、edges、findings、sources 的 path/digest。
- evidenceIds、repositoryTests、templates、派生 cache 与 diagnostics。

metadata 内的 `source.body` 和 feedback 的首次、最近远端 `body` 必须剔除。任何 `body`、配置原文、正文片段、证据或发布日志字节均不在持久 Schema；写入与读取均按白名单严格解码，额外字段拒绝。现有 `WorkspaceSnapshot` 仍是当前来源查询的独立类型；Web 使用新的 `WorkspaceProjection` 结构类型，不以空字符串代替正文。浏览器打开文档和配置通过已有 `/api/file` 读取；反馈来源详情通过定向当前 owner 读取。搜索只索引标题、ID、路径、URL。文档列表不显示正文前 150 字；项目文档标题用刷新时提取的单行 derivedTitle，非正文片段。

独立 workspace_projection 命名空间限 1 行、8 MiB，单行 payload 含 envelope 也不得超过该配额。

原生侧仅增加命名空间与 resource budget，领域模型仍在 TypeScript。

trace/review 的 query_cache 写入不能淘汰工作区行。

超限 WorkspaceProjectionOutputLimit，不截断诊断或回源。

打包消费者测量体积和争用后只允许收紧上限。

## HTTP 与 CLI

`GET /api/workspace` 返回 `ViewResponse<WorkspaceProjection>`。

有可读代次时 HTTP 200，响应含 `{ snapshot, projection }`。

projection 包含 `status: ready | refresh-failed | blocked` 与 `current:false`。

构建字段为 `builtAt/builtFrom/builtUntil`、`consistent`、`complete`、`changedPaths`、`unknownRelations`。

刷新字段为 `refreshOwner: active | none` 与可选 `lastError/lastAttempt`。

ETag 是该响应的 digest。

只有同 ETag 且缓存可读时返回 304。

无代次且刷新已申请时 HTTP 202、`ok:false`、`error:WorkspaceProjectionPending`。

浏览器显示“正在构建”，每 2 秒重试，不显示空健康结论。

最近刷新因 RecoveryRequired 阻断时，无代次返回 HTTP 503/RecoveryRequired，有代次返回 status:blocked 并附 lastError.code:RecoveryRequired。

两者都显示恢复入口。

缓存或原生模块无法安全读取时 HTTP 503，`WorkspaceProjectionUnavailable` 加具体原因码和操作提示。

首次加载遇到 `HawdbBusy` 时保持不可用提示，每 2 秒重试缓存 GET，直到句柄释放后读到代次；不重复提交刷新请求，不回源。其它不可用原因由用户修复后重试。

请求不执行全量来源扫描。

`workspace show` 与其 JSON 形状保持当前来源语义。

新增 `workspace projection --json` 只读同一缓存行，输出 `{ operation:'workspace-projection', snapshot, projection }`。

CLI 不启动刷新，无 View 服务时 `refreshOwner:none`，无代次报 `WorkspaceProjectionPending`，不可用报 `WorkspaceProjectionUnavailable`。

## 刷新 owner 与恢复

View 启动、HTTP 请求及浏览器每 32 秒工作区轮询可以申请刷新。

普通请求按上次扫描开始时间节流 30 秒。

活跃期间的普通轮询不排下一轮。

成功写入、显式恢复或手动重试可立即申请刷新。

Web 动作完成来源写入或任务发布证据后，由服务端申请刷新；刷新失败单独呈现，不能把已完成的写入回执改为失败。

只有这些请求在活跃扫描期间设置一个合并的后续刷新标记，完成后立即执行，不能重叠。

外部编辑通过下一次轮询触发。

不引入递归 watcher。

服务内单刷新调度器复用 ViewScanManager 的 owned process 与 60 秒扫描上限，请求本身永不等扫描。

多 View 进程使用 Git-private `workspace-refresh/current` file lease 互斥，粒度为 worktree（覆盖全部配置和安装身份）。

使用 acquireFileLease。

occupied 时只调用 recoverFileLease 验证及回收已死亡 token，再尝试一次。

recoverFileLease 对活跃或异机 owner 的拒绝均视为 occupied，活跃 owner 不等待、不抢占。

未持有者只读代次，下次轮询再尝试。

View 主进程持有刷新租约，worker 只返回候选、不写持久库。

主进程在确认 worker 回复、逻辑身份仍相同与租约仍归己后短事务写入，孤儿 worker 无发布权。

失败后最少 30 秒再尝试。

关闭取消自己拥有的扫描，确认进程组清理并关闭 HawDB 句柄后释放租约。

清理无法确认则记录 CleanupFailed，本进程停止刷新，重启后通过既有死亡 owner 恢复协议回收。

不按年龄抢占租约。

| 状态 | 可恢复条件 | 用户可见动作 |
| --- | --- | --- |
| building | 首次安全结构代次写入 | 自动每 2 秒重试，可手动重试 |
| refresh-failed | 下一次成功刷新 | 展示旧代次、失败码和重试刷新 |
| unavailable:native | 修复安装并重启 View | 展示原生模块诊断和重启提示 |
| unavailable:corrupt | writer 用同键新记录覆盖；数据库不可安全打开时明确清理缓存 | 展示损坏码，允许重试刷新；必要时提示 concord cache clear |
| blocked:recovery-required | 显式 concord recover 或现有 HTTP recover 成功 | 展示恢复中断发布按钮和错误码；恢复后立即申请刷新 |
| cleanup-failed | 确认退出并重启 View，按租约协议恢复 | 展示清理失败码和重启提示 |

## 当前编辑前像

工作区代次中的 digest 只触发检查。

它与编辑器 `baseline.current.digest` 不同且并非已处理代次时，至多发起一次 `/api/file` 定向读取。

只有读回 digest 仍不同且草稿干净才用读回正文替换，有草稿时进入 external 对比。

较旧代次 A 在较新定向基线 B 后到达，不用 A 替换 B。

提交始终使用建立草稿时 B 的 digest。

外部版本 C 导致冲突并保留草稿。

设置与元数据动作同样在编辑开始取得当前目标摘要，不从历史投影获取授权前像。

写入回执的目标内容由定向读取立即更新编辑器。

导航与关系接受一次后台扫描的延迟，期间明确显示正在更新，不能把新建对象短暂缺席当作创建失败。

写入发生于扫描中时保留一个合并的后续刷新请求，当前扫描结束后立即执行一次。

不以旧扫描满足该请求。

不同安装进程交替服务同一 worktree 时，固定行只保留最近身份，另一身份返回构建中并重建。

没有兼容读取或第二份缓存。

## 模块与消费者接口

共享类型统一由 `src/view-contract.ts` 导出。

`WorkspaceDocument` 为 DocumentRecord 去掉 body 且 issue metadata.source 去掉 body。

`WorkspacePage` 只含 path、digest、可选 documentPath 与 derivedTitle。

`WorkspaceFeedback` 含 document:WorkspaceDocument（kind 为 issue）、provider、triage、availability、warnings，以及去掉 body 的 remote。

`WorkspaceProjectionSnapshot` 使用上述集合替换 WorkspaceSnapshot 的 documents/pages/feedback，保留其它已声明派生字段。

`WorkspaceProjection` 为 `{ snapshot:WorkspaceProjectionSnapshot, projection:WorkspaceProjectionStatus }`。

`WorkspaceProjectionStatus` 使用本协议的状态字段。

持久 Schema 与投影生成/读取归 `src/workspace-projection.ts`。

刷新调度归 `src/view-projection.ts`。

现有 scan worker 只负责编译候选，HTTP 与 CLI 共用缓存读函数。

定向当前读取扩充既有 `ViewFile`。

可选字段包括 `document:DocumentRecord`（owner 解析成功时）、`project:ProjectConfig`（目标为有效 concord.config.ts 时）、`feedback:FeedbackItem`（目标是 issue owner 时）。

这些字段与 body/digest 在同一次严格当前读取内生成，仅针对请求目标，不扫描全仓库。

解析失败的原文仍按既有规则可读，字段缺席不制造有效 owner。

设置页从 api.file('concord.config.ts') 的 project/digest 建立前像。

元数据从 api.file(path).document 建立前像。

反馈详情从 api.file(path).feedback 读取完整来源正文。

保存后再次定向读取，不用 api.workspace 的历史结果确认保存。

无配置时 identity 使用显式 absent 标记，有非法配置时使用其安全读取的原文字节摘要，不能因此阻断初始化和修复配置页面。

定向 feedback.warnings 只报告该对象能确认的状态；重复远端身份等跨文件告警由结构投影提供，定向读取不为计算它们枚举全部 Issue。

## 性能验收

按[性能验收方法](../../../../engineering/concord-self-hosting/performance.md)使用打包安装的 CLI 与独立 HTTP 客户端。

已有可读代次时连续七次测量完整请求，HTTP warm p50 不超过 250ms、p95 不超过 600ms。

workspace projection 的七次新进程 warm p50 不超过 600ms。

报告同一数据集的文件数、投影字节数、原生版本和机器环境。

首次构建另报时长与状态，不计作 warm 成功。

已就绪请求不能包含全量扫描阶段。

配额计算包含命名空间、key 和完整 envelope 的字节数。

显式“重试刷新”使用 `POST /api/workspace`，严格空 JSON 对象 `{}`，沿用 Host/Origin 与 JSON 检查，响应 HTTP 202 `{ok:true,value:{status:'requested'}}`。

它只向唯一刷新调度器申请一次刷新（与成功写入同样合并），不等待扫描、不直接读取来源、不越过 cache unavailable 或 cleanup-failed 状态。

普通 GET 保持只读缓存并按普通节流申请刷新。
