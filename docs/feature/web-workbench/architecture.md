# Web 工作台架构

React Router 管理人用导航，Vite 产物放在安装包 `dist/web`。HTTP 由该 Git 工作区的[工作区服务](../local-data-engine/architecture.md#工作区服务)托管，见[服务托管](#服务托管)。HTTP 只接受严格解码的领域操作，CLI `action --input` 使用相同入口。浏览器不直接写 HawDB、journal、证据或关系注册表。

工作台根地址进入 `/git`，总览位于 `/overview`。Git 页默认列出全部未提交文件，文档与测试作为筛选；Git 读取失败独立显示错误和重试入口，不伪装为空列表。PR 静态产物的比较身份与发布边界见[变更预览](change-preview.md)。

反馈列表使用 `/feedback`，详情使用 `/feedback/:id`。页面链接直接使用当前路由，不维护版本兼容别名。

术语由 `docs/**/concepts.md` 拥有，目录决定作用域；文档术语页通过 concepts 工具读取当前文档目录的有效定义、直接导入与来源诊断，不在前端解析 catalog 或自行实现第二套合成规则。术语编辑打开 catalog 源码，保存调用 `concepts.set`。全项目汇总与写作页共享同一后端来源，不建立术语注册表。

`docs/` 下不属于 Feature、Roadmap、Design、Research、Engineering 或 Issue 的 Markdown 进入同一 inventory，由「文档」导航打开。`docs/taste.md` 与其它文档一样直接编辑。阅读不是合规证据。

`docs/` 与 `memory/` 下的 Markdown 经 `document.set` 以整文件摘要写入。`document.set` 解析目标的当前原文与候选原文，按[自动保存](README.md#自动保存)列出的字段与规则比较二者，命中时在发布前拒绝；其它差异不做语义判断。术语编辑器经 `concepts.set` 写入，写入前校验 catalog。`source.set` 只写配置范围内的既有 JS/TS 文件，其余路径只读。单文件读取仍不枚举全仓库。

只读 Markdown 按 [MDXEditor 官方建议](https://mdxeditor.dev/editor/docs/overview) 使用独立阅读渲染器。复用 react-markdown，通过 remark-frontmatter 识别元数据；rehype-raw 后接 rehype-sanitize，不使用未经净化的 HTML。保留净化器的 DOM clobbering 前缀，由阅读导航映射源锚点，不能为保留锚点关闭净化。正文和原文／元数据详情来自同一读取结果；预览不产生写入或自动归一化。可编辑正文继续使用 MDXEditor 及原文回退，错误不得清空草稿。

参考模板树从现有 inventory 的路径派生，由共享 ContentSidebar 渲染；不新增存储索引。树形导航采用 [WAI 折叠导航模式](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/) 的嵌套列表、aria-expanded 按钮和 aria-current 链接。目录展开是展示状态，文件选择由 URL 拥有；筛选和当前文件定位不建立另一份导航来源。

每次领域操作独立取得、释放 LocalRepository；读取与规划不持锁，提交短暂取得独占发布租约。写入、恢复与证据终结在服务拥有的操作进程中执行，HTTP handler 只转交严格解码的操作并返回回执。测试由服务拥有的单槽 job 管理，浏览器断开不取消任务。取消须确认子进程组退出，才能释放租约和运行槽，失败时保留租约并提供诊断。

工作区导航读取[工作区投影](#工作区投影)，不在请求内扫描来源。

后台编译复用 trace 生成诊断。文档与代码的纯解析结果使用有容量上限的 HawDB 内存缓存，以当前原文匹配；目录集合、文件读取、路径安全、配置、租约及恢复检查仍每次执行，不以时间戳代替内容校验。单文件预览只读取目标和其 README 归属链，全局 inventory 异常由 workspace/check 诊断。Git 测试基线在 HawDB 内存 namespace 中按 worktree、不可变 HEAD revision、测试根与解析器版本缓存，工作树状态仍实时读取。

浏览器以 `GET /api/events`（SSE）接收工作区服务的状态事件（结果变化、刷新状态与任务变化）。事件只作信号，收到后读取工作区缓存，读取串行执行；SSE 断开期间改为每四秒读取工作区缓存和任务状态并重连。Git 每三十二秒读取，轮询不重叠；首次构建期间每两秒重试读取缓存。读取不触发扫描，不重置当前文件或草稿。写入后的读取排在已有读取之后。首次取得工作区后不立即重复读取。同一 Research 主题内切换文件保留文件树节点、折叠和滚动状态，加载占位保持工具栏布局。

文档与源码使用一套当前恢复日志，按写入范围区分文档事务和源码事务，不维护历史格式兼容分支。源码事务冻结经过验证的配置范围与身份，仅替换既有 JS/TS 常规文件，不与配置修改混合。prepared 可回滚，committed 只核验完成后的内容；外部改动导致具名冲突，不删除恢复现场。

Web 操作者拥有与本地 CLI 相同的仓库代码执行能力。默认只监听 127.0.0.1:4317，不使用访问密钥或身份认证；显式 `--host` 开放后，任何能连接端口的人都可以读取和修改仓库、运行配置的测试命令。

Host 接受合法的域名、IPv4 与 IPv6 authority。请求携带 Origin 时必须为 HTTP/HTTPS 且与 Host 匹配；不携带 Origin 的请求仍可访问，默认端口按 Origin 协议归一化。拒绝重复 Host、非法 Origin 和能改变 authority 的请求路径。Host/Origin 校验不提供身份认证或 DNS rebinding 防护。

刷新页面保留当前深链接。HTTP 面向可信网络；TLS 终止代理必须保留浏览器使用的外部 Host（含非默认端口），不自动信任代理转发头。Markdown 中只有显式 p5 图块经专用沙箱运行，普通 HTML 脚本和 MDX 不执行。

## 服务托管

`concord view` 连接或启动工作区服务，请求以 `--host` 与 `--port`（默认 127.0.0.1:4317）开启监听，得到绑定实例 token 的租约。相同 `(host, port)` 的请求共用一个监听并各得一个租约；端口已被其它程序占用时返回具名错误。监听在仍有租约或仍有浏览器 SSE 连接时保持：`view` 退出只释放自己的租约；面板为打开浏览器开启的租约在没有 SSE 连接 10 分钟后释放。最后一个租约释放且没有连接时关闭监听。Host/Origin 检查与信任边界不因托管位置改变。

服务停止时先向 SSE 连接发送 `stopping` 事件。页面显示服务已停止及重新运行 `concord view` 的提示；新服务不自动恢复旧监听。

## 工作区投影

工作区导航是可重建的派生视图，来源文件仍是事实 owner（[缓存与原生边界的约束](../local-data-engine/architecture.md#缓存与原生边界的约束)、[缓存与原生边界的约束](../local-data-engine/architecture.md#缓存与原生边界的约束)）。Web 与 `workspace projection` 共享服务端维护的一份结构投影，使读取与全量扫描解耦；当前查询与定向编辑保留严格前像。公开字段与错误见 [CLI 页](cli.md#工作区投影)。

### 读取与发布

历史投影由 `LocalRepository.observeProjection(read)` 读取：沿用 `snapshot()` 的路径安全、Schema 解码、观察记录与句柄关闭。读取后比较文件内容与目录集合，返回 `{ value, drift: { files, directories, publicationChanged } }`。这些漂移不抛错；前后都须确认没有待恢复 journal，单独的 revision 变化在 `changedPaths` 中记为 `.`。配置变化、RecoveryRequired、路径安全失败和无可用结构的编译异常具名抛错并丢弃候选。`snapshot()`、`verifySnapshot()`、当前 CLI、check、写入与证据路径不用该原语。

刷新开始与写入前都重算身份，不一致时丢弃候选并立即以新身份刷新，不记为失败。安装身份在进程内首次计算后不变，配置字节每次重读。

一次刷新最多 60 秒，漂移时不重扫，首次即可发布 `consistent:false` 的结果。`complete = consistent && 扫描完整`，`unknownRelations = !complete`。`buildTrace` 异常仍能形成安全结构与具名 finding 时发布不完整的结果，无结构时不发布。替换遵守[替换规则](../local-data-engine/architecture.md#替换规则)：新的一致结果即使含 finding 也替换旧结果，不一致的候选不替换已有一致结果，只更新 `lastAttempt`。

### 持久记录

独立 `workspace_projection` 命名空间只有 key 为 `workspace` 的一行，payload 格式为 `concord.workspace-projection/v1`。它含 `identity`、可选 `record`（构建区间、完整性字段与结构 `snapshot`）、`lastAttempt`（不含快照）与 `error`。一次 put 原子替换该行，新身份覆盖旧行；损坏记录不提供给前台，writer 可直接覆盖。身份由 worktree root、Git-private 目录、配置原文摘要（无配置为 absent，非法配置仍取安全读取的字节摘要）、安装目录全部 JS 与 native 产物摘要及类型 `workspace` 组成。读取前先验证原生模块，缺失为不可用而非尚无结果。

快照由 `WorkspaceProjectionSnapshotSchema` 白名单严格解码，读写都拒绝额外字段。它只含路径、摘要、metadata、单行 derivedTitle、关系、诊断、反馈分诊与概念目录；概念目录列出每个 `concepts.md` 的路径与其中每个概念的术语、锚点、弃用名与现行写法，定义与解释正文不进入。正文、`source.body`、远端 body、配置原文、证据与发布日志不进入 Schema。搜索只索引标题、ID、路径与 URL。

配额 1 行、8 MiB，计入命名空间、key 与完整 envelope；`query_cache` 写入不淘汰该行。超限报 `WorkspaceProjectionOutputLimit`，不截断、不回源；实测后只允许收紧。原生侧只提供命名空间与资源预算。

### 刷新所有权

`ViewProjectionManager` 运行在工作区服务中，拥有监听、调度与关闭。服务启动、监听事件、服务端写入或证据发布、恢复、`POST /api/workspace` 与每 30 秒的补偿定时器申请刷新，不依赖浏览器。扫描期间的写入、显式请求与监听事件合并为一个后续刷新，完成后立即执行；补偿请求不排队。漂移的结果发布后一秒再申请一次。刷新失败不改变已完成写入的回执。

服务锁保证每个 worktree 只有一个刷新者。扫描在服务的计算进程中执行，60 秒上限与超时整组终止沿用 `ViewScanManager` 的规则，计算进程只返回候选；主进程确认回复、身份与无待恢复 journal 后短事务写入，孤儿 worker 无发布权。

遇到 journal 时，若它已移除或本工作区发布 owner 仍存活，丢弃本次扫描并重新调度；否则记录 RecoveryRequired。服务持有持久句柄，发布不与其它进程争用数据库。

| 状态 | 恢复条件 | 呈现 |
| --- | --- | --- |
| building | 首份结果写入 | 每 2 秒自动重试，可手动重试 |
| refresh-failed | 下次成功刷新；漂移与身份变化不进入此状态 | 上一份结果、失败码与重试 |
| unavailable:native | 修复安装并重启服务 | 原生诊断与重启提示 |
| unavailable:corrupt | writer 覆盖，或无法打开时清理缓存 | 损坏码、重试，必要时提示 `concord cache clear` |
| blocked:recovery-required | `concord recover` 或 HTTP recover 成功后立即刷新 | 恢复按钮与错误码 |
| cleanup-failed | 重启服务，由服务锁回收 | 清理失败码与重启提示 |

关闭依次停止定时器与监听、等待监听核对、取消扫描并确认进程组清理、关闭句柄，之后不再发布。清理无法确认时记录 CleanupFailed 并停止刷新，服务退出后由下一个服务重新开始。

### 来源监听

监听只产生失效信号，不读正文、不编译、不发布，也不是安全边界或当前事实证明。启动时监听仓库根与 docs，首次扫描后按配置覆盖 sourceRoots、testRoots、`runner.sourceFiles`、`memory/` 与投影 sources，缺失目录监听已有祖先。每个目录非递归监听，跳过 `.git`、`node_modules` 与符号链接，不按事件路径读取来源。事件在 250 ms 内合并，持续写入最多两秒后申请刷新；每次扫描后核对监听集合，新增监听后补一次刷新，目录删除或替换后重建。至多 8192 个目录句柄；失败报 `WorkspaceWatchUnavailable`，保留缓存并靠补偿刷新，下次扫描重建。缓存写入不触发监听。

### 编辑前像

正文、设置、元数据与反馈详情的前像只来自 `/api/file`。`ViewFile` 在同一次严格读取内可附目标的 `document`、`project` 或 `feedback`，不扫描全仓库；解析失败的原文仍可读，不制造有效 owner。定向 `feedback.warnings` 只报告该对象可确认的状态，跨文件告警来自投影。

投影 digest 只触发核对：与编辑器基线不同且未处理过时，至多发起一次定向读取；读回仍不同且草稿干净才替换，有草稿则进入 external 对比。编辑器基线只在服务端确认的文件摘要等于读回的摘要时更新，旧事件不会覆盖较新的基线；提交使用建立草稿时的 digest；保存后定向读取确认。导航在下一份结果到达前显示正在更新，新建对象短暂缺席不是创建失败。不同安装的服务按[启动与裁决](../local-data-engine/architecture.md#启动与裁决)交接同一 worktree，只保留最近身份，不提供兼容读取或第二份缓存。

### 模块

投影类型由 `src/view-contract.ts` 导出，去掉正文而不以空字符串代替；`WorkspaceSnapshot` 只属当前来源查询。Schema 与读写归 `src/workspace-projection.ts`，调度归 `src/view-projection.ts`，监听归 `src/view-source-watch.ts`；scan worker 只编译候选，HTTP 与 CLI 共用缓存读取。

## p5 图解

编辑器与阅读渲染器共用 p5 组件。`POST /api/p5/compile` 严格解码文档路径、源码和选项，验证文档可读后捕获相对依赖。读取使用乐观快照，编译后核对读取文件的字节。TypeScript 检查只访问捕获的模块与随包的可信类型；esbuild 不使用消费者的插件、构建配置或包解析，不在服务端执行 sketch。

编译结果只在当前浏览器使用，不生成文件 owner 或持久缓存。`/p5-frame` 提供随包的 p5 运行时，iframe 与响应 CSP 同时设置无同源权限的沙箱。子页面使用独立 CSP，父工作台不开放内联脚本；API 和其他页面拒绝 frame 导航。来源窗口与消息 Schema 共同限制控制消息，沙箱不拥有读取仓库的消息接口。

仅 p5 子页面允许动态函数生成，以兼容核心校验器与 shader 功能；该权限不扩展到父工作台，也不授予同源、网络或仓库访问能力。

CSS 与静态资源进入当前图块的编译结果。项目配置的 `p5.libraries` 拥有库选择与加载顺序，Markdown 不覆盖该集合。内建扩展按固定名称和版本选择，本地扩展相对项目根解析，自定义逻辑模块以相对文件导入；联网和设备权限不随绘图库 API 自动开放。运行停止或组件卸载时移除 iframe，释放该浏览上下文的资源。支持范围和预算由[交互图解 Spec](use-case/embed-p5-sketch.md)拥有。

## 项目测试只读投影

工作区复用 `compileTraceUnderLease` 和 `showFeature`，从用户已写入的测试与源码标记派生关系，不写第二份登记表。测试页列出关联到 Feature 与 Use Case 的测试；实现页按 Feature 公共实现及各个 Use Case 分组，只展示明确关联的实现文件、符号、范围和 Spec；同一源码可出现在多个实际关联组。测试文件保留在测试页。点击实现位置打开源码并选择对应行范围；空组提供预填当前 Spec 的关联入口。未配置目录、扫描失败、筛选无匹配和确实无关联分别呈现，扫描失败不得回退成空列表成功。

服务将慢请求写入 stderr：处理耗时或采样到的事件循环延迟达到 250 ms 时，记录方法、规范化路由、状态、完成标志、耗时、阶段及有限原因标签。每分钟最多 20 条，后续记录带被抑制数量；stderr 积压达到 64 KiB 时跳过。阶段至多 24 个命名项及一个汇总项，不记录请求正文、查询参数、文件路径、请求头或原始错误详情。

扫描计时区分测试注释、文档关系、品味、代码来源读取、缓存与解析、来源复核。日志分别记录测试和代码缓存的状态及命中数，不可用原因只输出允许的错误码。`cache status` 的 ready 不作为请求命中证据。公共扫描与缓存批处理见[架构流程图](../../architecture.md#存储-spec)；Web 复用该流程，不拥有另一套解析缓存。

处理耗时从 HTTP handler 接纳请求开始；事件循环延迟为进程采样观察，不能作为该请求的精确排队时间。嵌套阶段时间包含子阶段，不能相加。客户端全程耗时应由独立进程测量。HTTP 200 只表示响应成功，列表须读取 `projection.consistent`、complete 和 findings；缓存不可用、扫描期间来源变化与孤立标注分别诊断。

## URL 与导航状态

URL 是导航状态的唯一来源。文档 `tab`、正文 `file`、Use Case 路径、源码 `source/sourceLine/sourceEndLine`、设置 `tab`、Git `tab/path/area/line/view` 和结果 `resultView` 直接驱动组件。不用 `useState` 或 ref 复制当前导航值再经 effect 双向同步。Git 两类文件的上次选择保存在 URL 的 `docsPath/docsArea/testsPath/testsArea`。未提供或无效的选择按页面能力回落，外部路径仍由服务端验证。`?tab=actions` 在不支持生命周期的对象上回落到元数据。

用户切换产生历史项；前进、后退和深链接使用同一条渲染路径。drawer 关闭只在当前运行实例能证明紧邻父项时后退，否则替换到明确父 URL；刷新后不信任旧 history state。源码关闭保留所属文档的 tab/file，Use Case 关闭回所属 Feature 的 Use Cases。历史 provenance 只证明关闭去向，不保存可见选择。

编辑草稿、请求状态和临时表单由组件拥有。全局路由 blocker 统一处理离开前保存，不维护第二个 pending destination。只读内容不注册自动保存；唯一活动草稿 owner 负责 flush、dirty 与 discard，旧 owner 清理不能影响新 owner。设置的表单与 JSON 在离开前保存当前表示；失败保留原 URL 和草稿，明确丢弃先恢复 baseline 并取消延迟保存。导航等待期间继续编辑必须保存最新 revision，过期导航回调不得跳转。

滚动缓存只属于展示层，按历史项记录桌面、移动容器与 drawer 位置；等待异步内容后恢复，用户主动操作停止补偿。刷新恢复导航位置，不承诺像素位置。结果页视图可深链接，但瞬时命令返回值不会为恢复页面而自动重跑。

浏览器验收覆盖保存冲突、非法 JSON、连续导航、嵌套关闭、刷新和前进后退。

## 编辑与执行生命周期

编辑器加载已保存正文和摘要，用户修改形成浏览器草稿。初始 Markdown 归一化不会令文件产生保存；点击保存后带原摘要提交。外部 CLI 修改导致冲突时保留草稿，用户对照新版本处理，离开页面前提示未保存内容。

Git 已暂存、未暂存与未跟踪变化独立于浏览器草稿。保存后刷新 Git 状态；查看 diff 不执行 Git 写操作。

测试任务从 queued 进入 running；取消进入 cancelling，待进程组清理结束后进入 cancelled。成功执行进入 completed，领域或执行错误进入 failed。清理不能确认时进入 cleanup-failed，保留锁并阻断后续操作。命令结果不等于原生测试覆盖证明。
