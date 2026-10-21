# LSP client

## 代码关联与符号定位

所有关系身份引用[共同契约](../../../test-journey-steps/共同身份.md)，不从 LSP 符号路径或原生清单派生。非 TypeScript 声明从配置范围内的源码标记重建，身份为文件路径加标记块序号；行号只是当前位置。JS/TS 继续使用现有 AST 声明与派生引用。

非 TypeScript 扫描识别独立注释行中的文件、代码、区域及 implements 标记。文件声明定位到文件，区域声明定位到配对标记，代码声明无当前观察时定位到标记行。扫描不声称识别所有语言字符串语法，也不由符号是否存在决定关系是否存在。

符号定位记录安全路径、`range`、`selectionRange`、显示名称与来源 profile；它是可选 `Observation` 值，不是公共关联 ID。范围缺失或歧义产生 `UnsupportedSymbolBinding` 观察缺口，保留源码声明。标记自身语法、配对与契约引用错误仍从源码产生 finding，不依赖观察。

## 配置与兼容能力

`ProjectConfig.languageServers` 是可选配置，使用严格 Schema 解码。每项有唯一 `id`、`languageId`、非空 `extensions`、`profile`、非空 `argv`、安全仓库内 `cwd`、`initializationOptions`、`implementationFiles`、`sourceFiles` 与 `budgets`。

扩展名匹配按完整后缀，不允许重叠、JS/TS 扩展或重复 ID。`implementationFiles` 覆盖真实 server 入口、脚本、插件和依赖锁，不以启动器 `argv[0]` 代替实现身份。环境只传显式允许的非秘密变量；不读取用户凭据配置，不把环境变量全集写入日志。

`profile` 是声明数据，不加载项目代码。它指定固定 server 版本、注释前缀、允许的声明 kind、符号形态、装饰器与前置注释规则、索引就绪信号和位置编码。其规则只能引用 Concord 提供的词法与范围策略；不能用任意正则或脚本伪装新增语言解析器。

兼容能力分为源码关系扫描、符号定位、调用观察三项。发布支持矩阵必须按语言、server 版本、profile 版本分别给出真实 fixture 证据。Python/Go/Rust/Java 是验收目标；在证据不足时只承诺标记关系与具名缺口，不宣称具体 server 已兼容。

`budgets` 包含总耗时、单请求耗时、stdout/stderr 总字节、单消息字节、消息数、请求数、并发数、文件数、符号数、调用节点数与深度。深度默认 3；省略其它预算时使用随包固定上限，配置只能采用正整数且不得突破包级硬上限。

## 符号绑定

完成 `initialize`、能力核验与 `initialized` 后，按实际同步能力打开文档。通过协商编码换算位置；未协商时使用 UTF-16。UTF-8/UTF-32 只有在双方明确支持且换算验证通过时可用。URI 仅接受本仓库安全 `file` 路径；拒绝路径逃逸、符号链接逃逸和非文件 URI。

按 [LSP 文档符号规范](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/language/documentSymbol.md)，层级 `DocumentSymbol[]`、扁平 `SymbolInformation[]` 与 `null` 分开处理。扁平结果不能推导层级或 AST 范围；本候选对它返回 `UnsupportedSymbolBinding`，不构造虚假符号路径。

每个范围须有序、位于当前文本内，`selectionRange` 包含于 `range`，子范围包含于父范围。profile 定义 `range` 是否包括装饰器与前置注释；`selectionRange` 只用于声明名定位与调用准备，不当作完整声明范围。

绑定从整个标记块结束位置出发，按 profile 跳过允许的空白和声明前置内容，匹配最近的可绑定声明起点。标记位于范围内的情况只在 profile 明确支持前置注释时接受。先选最近起点，再选最深的声明；类内方法不会被外层类替代。

同名符号按起点、终点、kind、名称排序，仅用于确定展示顺序。两个候选仍占同一位置或范围不可验证时返回歧义缺口，不通过序号强行绑定。索引就绪取 profile 声明的可验证信号；无信号或超过等待预算为 `IndexReadinessUnknown`，不得用一次请求成功代表全项目就绪。

## 调用观察

使用共同 `Observation<T>`，值包含测试关联引用、分析范围 `file` 或 `native-case`、原生绑定输入、调用边、命中的代码声明及相关性。已有调用边只证明收到的正向观察，不证明测试执行过调用或断言正确。

有当前 adapter 原生绑定与有效范围时，从范围内全部可调用声明出发；遍历类内方法和嵌套声明，不只取文件顶层类。没有有效绑定时使用文件级范围并标记 `FileScope`，不能称作单个 case 的行为证据。原生范围只细化观察，不进入测试 ID 或源码关系。

请求 `prepareCallHierarchy` 与 `outgoingCalls`，沿安全仓库路径遍历，允许穿过 `testRoots` 的中间调用函数。仅在映射实现声明时筛选 `sourceRoots`，不提前丢弃测试中的转调节点。仓库外目标与不支持文件不继续展开，并记录边界缺口。

[LSP 调用层级规范](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/language/callHierarchy.md)没有全程序完备性保证。本候选的调用观察始终 `complete: false`，至少带 `OpenWorldCalls`；空数组、`null` 与全部请求成功均不能推导未调用关系。

深度、节点或请求预算耗尽，分别记录 `DepthLimit`、`NodeLimit`、`RequestLimit`；能力缺失、部分结果未收齐、未就绪、动态派发、未知目标、子进程和协议调用分别保留具名缺口。非故障的截断可发布已有正向观察，进程与协议故障则不发布新快照。

相关性按共同契约输出。存在声明交集为 `observed`，附 `step`、`use-case` 或 `feature` 层级；文件范围必须同时标明归因限制。没有交集为 `not-observed`，显示“未观察到交集”及全部适用缺口。观察到其它 Feature 的实现也不推出行为无关，不生成 finding 或改变退出码。

## 身份与输入

分析以项目/root/worktree 加 server/profile 为一个分析单元。`Observation.inputs` 覆盖源码与测试的完整成员集合和字节、契约及配置、构建与模块配置、实际 server 实现与版本、选项、profile/算法版本、预算和位置编码，以及使用的 adapter 清单、绑定版本、范围与原生选择集合。

成员新增、删除、依赖文件、构建配置、server 脚本或原生绑定变化均使整个分析单元失效，不能只比对声明所在文件。显式 `sourceFiles` 只表示已声明输入，不证明真实依赖闭包。未核验的 ignored 文件、系统 SDK、外部环境和 server 私有索引记为 `UnverifiedEnvironment`。

`current` 只表达仓库内输入的一致性：分析单元在仓库内的成员集合与字节、配置、`implementationFiles`、`sourceFiles` 与原生绑定在复核时与当前来源一致，即标 `current: true`。仓库外无法核验的系统 SDK、外部环境与 server 私有索引不进入 `current` 判定，而是加入 `UnverifiedEnvironment` gap，使 `complete: false`。仓库内任一输入变化或在分析期间漂移时标 `current: false`，只作历史展示，禁止当前符号定位与相关性裁决。`current: true` 的观察可以用于符号定位与 `observed` 判定，其 gaps 照常展示。

固定可复现环境才比较重建后的观察；server 内部状态未知时不承诺清空缓存前后结果相同。

历史展示附输入摘要、server/profile、时间、`current`、`complete` 与 `gaps`。读取时验证分析单元当前身份；缺失、损坏或摘要不符只产生观察不可用状态。`check` 完全忽略观察；当前代码关系、测试关联与其完整性直接从源码重建。静态关系不会因分析失败或缓存清除而变成不完整。

## 信任与执行边界

只有显式 `code analyze` 授权启动配置中的 server；`test run`、`collect`、静态命令与编辑器服务不隐式调用它。server 是消费者选择的受信执行程序，可能启动构建、工具或访问文件与网络。进程组管理不是文件系统或网络沙箱，不能保证第三方程序无项目写入副作用。

Concord 的 LSP client 不发 `workspace/executeCommand`；收到 `workspace/applyEdit` 返回 `applied: false`，收到非约定的执行/编辑请求返回协议拒绝。其它 server 请求采用方法白名单与严格解码，配置响应仅含显式公开项；不得转交秘密、执行交互命令或代写 owner。

拒绝 LSP 编辑请求不能阻止 server 自行写文件。输入前后复核发现项目变化则返回 `AnalysisSourceChanged`，保留旧观察为历史；不会把变化后的调用结果发布为原输入的当前快照。凭据及原始环境不进入缓存或诊断。

## 分析生命周期

1. 在开始任何外部进程前取得既有 runner 所有权，捕获 candidate、配置、成员和完整输入身份，记录 run 状态；来源快照与 HawDB 持久句柄随后关闭。分析与测试收集不并发占用同一 runner。
2. 在 Effect Scope 内启动受管进程组，stdio 传递有界 JSON-RPC。完成握手、文档打开与就绪检查后采集符号和调用观察，不持来源快照或文档发布 lease 等待进程。
3. 取消先发送协议取消，结束时平衡文档关闭，再 `shutdown`、`exit`。超过退出宽限则对进程组 TERM，随后 KILL；核对进程组与输出管道终结，不能只检查主进程退出。
4. 进程启动、协议、总输出、单消息、超时或取消失败不发布新观察。清理未知时依既有 runner 协议保留 quarantine 状态，阻断发布；旧快照仅供明确标识的历史展示。
5. 清理成功后取得新来源快照，核验全部成员、摘要、candidate、配置、run 失效标记与发布代次。任一变化返回 `AnalysisSourceChanged`；前后摘要相同也不抹除运行期间的失效标记。
6. 关闭来源及持久句柄后，在短发布协调中复核身份与代次并写 HawDB 投影，不持协调等待 server。协调冲突或缓存写失败返回具名失败，不影响源码关系；只释放本 run 拥有的资源。

## 编辑器服务

`concord lsp` 只用 stdio，为每个会话建立 URI 到文本、languageId、版本与打开代次的 overlay。打开文档优先使用客户端全文，未打开依赖读取受校验磁盘快照；不把最近历史关系投影静默当作当前图。

| 事件 | 文档生命周期 |
| --- | --- |
| `didOpen` | 校验安全 URI、语言、唯一打开状态与初始版本，加入 overlay 并增加会话代次 |
| `didChange` | 要求版本递增；按协商编码顺序应用增量范围，越界或版本倒退时清除该文档诊断并标不完整，等待关闭重开 |
| `didSave` | 保留客户端拥有的文本；带全文时须与 overlay 一致，磁盘摘要只用于核验落盘与依赖变化，不以旧磁盘覆盖 overlay |
| `didClose` | 取消相关任务、清空该 URI 诊断并删除 overlay，后续读取磁盘；重新打开使用新代次 |
| 删除 | 使磁盘来源失效；仍打开的缓冲区作为未落盘文本保留，缺失归属或依赖明确标不完整 |
| 重命名 | 只响应已发生的文件通知；旧 URI 失效，新 URI 按新身份读取；打开缓冲区要求关闭旧 URI 并打开新 URI，不猜测移交文本 |

条款抽取与写作检查、测试和代码标记、路径归属与引用解析均使用同一 overlay 版本集合。步骤只按共同契约识别，不依赖章节文字；验收条目按共同契约不得使用步骤语法；未标记项不进入步骤视图。目录政策和未打开依赖来自同一磁盘读取集合，计算结束前复核其摘要与发布代次。

以源码引用、owner、步骤和目录政策建立派生依赖，重算受影响记录及其消费者。无法确认完整输入时标记结果不完整，不发布完整项目通过状态。其它历史部分显示时间与缺口；有未保存依赖变化时，磁盘分析观察不用于当前符号绑定或相关性。

每次任务捕获会话代次、全部依赖 URI/version/打开代次与磁盘身份。发布诊断或返回定义、引用、补全、悬停前再次核对；任一依赖变化即丢弃旧结果并重排任务。诊断带文档版本，旧结果不得清空或覆盖新版本诊断；过期请求返回 `ContentModified`，取消返回 `RequestCancelled`。

定义跳转到当前 overlay 中的契约 anchor；引用从当前源码关系定位测试与实现；补全使用同版 canonical 路径和步骤 ID；悬停显示同版正文及明确标识的观察。`StepNotFound` 只在相应输入完整且该步骤确实不存在时发布，不能拿磁盘旧图诊断未保存引用。

服务不注册编辑、格式化、代码操作、`executeCommand` 或 `willRenameFiles` 编辑能力。收到编辑请求返回拒绝，不写 owner 或持久化 overlay；不启动外部分析进程。会话关闭或 stdin 结束时取消任务、释放内存索引与句柄，取消后的迟到响应不进入缓存。

## 具名结果

| code | 处置 |
| --- | --- |
| `InvalidLanguageServer` | 配置、扩展名、路径或预算无效，启动前拒绝 |
| `UnsupportedSymbolBinding` / `CapabilityMissing` | 保留标记关系和标记行，记录观察缺口 |
| `IndexReadinessUnknown` / `PartialResult` | 记录不完整性，不声称符号或调用集合完整 |
| `LanguageServerFailed` / `AnalysisBudgetExceeded` / `AnalysisCancelled` | 清理进程组，不发布新快照 |
| `AnalysisSourceChanged` / `AnalysisInputUnverified` | 拒绝当前快照，旧结果仅作历史 |
| `AnalysisCleanupUnknown` | 保留 runner 阻断状态，不发布 |
| `ContentModified` / `RequestCancelled` | 淘汰编辑器请求结果，不发布旧诊断 |
