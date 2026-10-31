# 架构

## 编译管线

Concord 从 Markdown owner、TypeScript AST 可识别的代码声明，以及测试根里的 Concord 标记读取事实。工具解析 canonical path 与 anchor，验证目标类型、重复关系和循环，再生成 trace、review 与检查结果。测试标记不解析宿主测试语法。

sourceRoots 与 testRoots 分别控制实现和测试扫描。代码声明解析可按文件命中可删除 HawDB 投影，键含 worktree、解析器版本、路径和字节摘要。当前事实门禁从当前 Markdown 重算；诊断历史投影按异步查询 Spec 保存。测试投影按整次扫描缓存，身份包含项目、路径集合、各文件摘要、runner 配置与解析器版本；任何一项变化、文件改名删除或缓存损坏时，从源码重建。命中都严格解码。

## 入口与命令加载

`concord --version`、各层 `--help` 与无参数调用由构建时生成的静态数据直接输出，不加载 Effect、命令模块或原生产物。静态数据从实际命令定义生成：构建时以原 CLI 执行每条帮助路径，记录 stdout、stderr 与退出码。运行时只在 NO_COLOR、TERM=dumb、非 TTY 等与生成时相同的渲染条件下使用它，其余情况交给完整 CLI，输出逐字节一致。

其它调用按顶层命令组加载：入口只导入被调用命令组的模块图，不静态导入全部命令。静态数据或命令模块缺失、与安装身份不符时，入口回退到完整 CLI，结果与回退前相同。源码运行（`pnpm concord`）使用同一入口逻辑。

入口在加载任何命令模块之前启用 Node 编译缓存，目录为 `${XDG_CACHE_HOME:-~/.cache}/concord/node-compile-cache`，遵守 `NODE_COMPILE_CACHE` 与 `NODE_DISABLE_COMPILE_CACHE`。目录不可写或被禁用时照常加载，不改变命令结果。

## 自举

本项目的实现文件与关键函数直接声明各自的 Feature / Use Case。共享基础模块关联 Feature，具体行为关联各条 Use Case；注释渲染使用显式 region。selfhost 验收要求每条 Use Case 都存在真实实现和测试关联，源码旁的声明仍是唯一 owner，不另存模块到功能的映射表。

## 执行管线

只有 `test run`、`test verify` 与 `issue close --fixed` 启动仓库命令。runner argv 逐参数替换 `{file}`、`{name}`、`{pattern}`，不经过 shell；timeout、取消和输出上限都由受 Scope 管理的进程组清理。运行结果记录 command outcome 与 observed execution，未知或全跳过不会被包装成 case passed；结果不持久化。`code analyze` 启动的 language server、adapter 收集与测试执行共用同一套 runner 进程所有权和清理。

## 修复核验

只支持线性路径：先提交会失败的回归测试，再提交修复（[决策依据](../../design/sdd-core-model/DECISION.md)）。可观察行为见[核验修复并关闭缺陷](use-case/resolve-with-command-evidence.md)。

1. 回归测试由 `@issue` 标记选出。修复候选默认是核验开始时的 HEAD，`--fix` 可以指定其 first-parent 历史中缺陷候选之后的提交；工作树中他人的未提交改动不参与核验，只要求该 Issue 文件没有未提交改动。
2. 缺陷候选默认是 HEAD 的 first-parent 历史中最早出现这些回归测试的提交；`--defect` 必须是 HEAD 的 first-parent 祖先。
3. 从缺陷候选到修复候选之间，测试文件、`runner.sourceFiles` 与测试指向的 Spec 字节不变，严格解码后的项目配置除 `runner.prepare` 外不变；配置文件的空白与格式不参与比较。区间中有 merge 提交时不支持。
4. 以 detached worktree 分别检出缺陷候选与修复候选。检出位于仓库目录树之外：系统临时目录下属于当前用户、权限 0700 的私有目录，不跟随符号链接。检出若在仓库目录之下，依赖解析会向上找到主工作树的依赖，使构建结果不同于干净检出。每个检出先依次执行 `runner.prepare` 的命令（例如安装依赖与构建），再运行 runner。`prepare` 只准备环境，取核验开始时 HEAD 的配置用于两个检出（重放同样取当时 HEAD 的配置），不属于第 3 步的冻结输入，因此早于它出现的提交也能核验；准备命令以非零码结束、超时或清理未知时核验报 `FixUnverifiable`，不计为 red。全部命令在 runner 租约与 OwnedProcess 下执行，结束后删除临时 worktree；清理无法确认时按 runner 阻断处理。
5. 缺陷候选上同一冻结命令以非零码结束，修复候选上以零结束。command runner 不区分断言失败与构建失败，red 只表示该命令的非零结果；runner 结果判定为零执行、全部跳过、取消、信号终止或清理未知的运行不计为 red 或 green。缺测试、缺提交（含 shallow clone）与超时是 `FixUnverifiable`。
6. 发布前重新核对 Issue 文件的前像，变化则拒绝。写入的 `verification` 包含缺陷与修复提交、按测试关联 ID 列出的回归测试、runner 配置摘要与执行它的 Concord 版本。

`verification.fix` 是实际验证的提交 F，承载关闭记录的提交通常在 F 之后。`test verify` 与 `check --since` 都在记录的缺陷提交与 F 的临时检出上重放，核对的是记录本身的主张：回归测试在缺陷提交上失败、在 F 上通过。之后的提交改动测试、runner 输入或 Spec 不使记录失效；已经关闭的记录不随后续变化重放，之后的回归由完整测试发现。提交、依赖或运行环境不可获得时报告无法重放，不改变已记录的结论。reopen 删除 `closure`。

## 写入管线

文档 mutation 在取得写入占用后校验 canonical relative path、每个 symlink 组件与完整 preimage，再把全部计划变更写入绑定 root 与 privateDir 的 journal。文件以同文件系统临时文件和原子 rename 逐个发布，全部提交后才刷新可重建缓存。读取发现未完成 journal 时要求显式 recover；内容既不匹配 preimage 也不匹配 planned digest 时拒绝覆盖外部编辑。命令助手与 Web 保存都走这条管线，Web 保存以整文件摘要作为前像；人与 agent 的直接编辑不经过它，由[差异门禁](#差异门禁)检查。

## 差异门禁

`check --since <base>` 先完成当前状态检查，再用 Git 读取 `<base>` 与当前之间变化的文件，对每个变化按 [CLI](cli.md#检查本次变化) 的表格检查。Issue 与 Memory 的状态转换比较基线与当前的 frontmatter。`verification` 的重放复用[修复核验](#修复核验)。`Selected:` 的校验复用 `design decide` 的同一规则。Roadmap 移动复用采用命令的链接规则。无法读取基线或差异时传播 `complete: false`，不退回只检查当前状态。

## 步骤改写的发布

`use-case format` 沿用正文编辑的前像与发布协议。`rename-step` 在唯一 journal 与 publication lease 下使用专用 `step-rename` 授权范围，不串联多次 `source.set` 或文档发布。该范围绑定项目、worktree、冻结配置、Use Case 路径、old-id、new-id、完整文件前后像、摘要与 mode，以及规划时观察的目录成员。

规划在同一次乐观快照中记录引用扫描所需的文件、目录成员和受管引用检查，受管引用经领域读取能力检查，不直接读取 owner 文件。提交取得短期独占 lease，复核配置、全部观察与完整变更集，沿用 runner 失效和隔离检查。正常发布与恢复共用范围校验，从前像复算允许的改写并拒绝超出授权的后像；旧版本 CLI 不降级处理该范围（[C-003](../../constitution.md#c-003)）。

## 代码声明引用

JS/TS 代码声明的 `id` 与 `code:<id>` 边为 `code-` 加 `JSON.stringify(["concord.code-reference/v1", relativePath, scope, locator])` 的 SHA-256 前 32 个十六进制字符，不含行号、正文、关联目标或绝对路径。

- file 的 locator 为空数组。
- node 的 locator 从 SourceFile 的子节点到绑定节点，每层为 `[SyntaxKind 字符串, staticName 或 null, 同描述直接兄弟的零基序号]`；直接子节点完整枚举，包含未标注节点。staticName 只取 Identifier、PrivateIdentifier、StringLiteral、NumericLiteral 的文本，ComputedPropertyName 与无名节点为 null，不读取或求值表达式；单变量语句取唯一变量声明的简单标识符。
- region 的 locator 为 `[statementListLocator, validRegionOrdinal]`，SourceFile 的列表路径为空，序号按该列表内合法 region 的源码顺序从零开始。

其它语言的声明引用由 `concord.code-marker/v1`、canonical 路径与文件内标记块序号派生。改变派生语义必须升级版本。稳定边界见[引用的稳定性](use-case/trace-code-ownership.md#引用的稳定性)（[决策依据](../../design/derived-code-reference/DECISION.md)）。

## 路径安全

仓库路径解析分两个入口。写入、建目录与删除、原子替换、journal、发布 preflight 与 apply、恢复、`discoverRoot`、`init` 及构造期的 privateDir 与 journal 检查使用完整检查：从文件系统根逐级核对 Darwin 字节拼写并 `lstat` 拒绝 symlink，不读取任何复用信息。只读快照内的文件读取与目录扫描使用读取检查，写入前像同样经读取检查取得（[C-003](../../constitution.md#c-003-1)）。

- 根锚点：仓库对象构造时对根做一次完整检查，记录从 `/` 到根每一级的 bigint `dev`/`ino`；快照深度 0→1 时打开根目录 fd 并与锚点比对，回到 0 时关闭。
- 读取检查在读字节前完成：逐级 `lstat` 核对锚点 inode，不枚举仓库根之上的目录；仓库内组件先做拼写核对，再 `lstat` 拒绝 symlink。文件以不跟随 symlink 的方式打开：Darwin 用 `O_NOFOLLOW_ANY`（要求 macOS 11 及以上，否则构造以 `UnsupportedHost` 失败），Linux 用 `O_NOFOLLOW` 并以 `/proc/self/fd/<fd>` 比对期望路径，不可用时拒绝读取。打开后 `fstat` 须为普通文件；大小或 `dev`/`ino` 与最后一次 `lstat` 不一致时按来源变化报 `SourceChanged`，在投影刷新中是可重试漂移，不返回部分值。
- 快照内目录列表：拼写核对复用本次快照的目录列表，并记录实际查过的 `dir/segment`；每次目录成员扫描都新鲜枚举，不复用拼写列表作为成员集合。列表不跨快照、不跨进程、不按时间失效，嵌套快照共享外层结构，任何自身写入开始前清空（[C-014](../../constitution.md#c-014-3)）。
- 结束核验在当前快照核验、投影漂移收集和发布前观察校验三处执行，使用只供本次核验的新列表：重新核对锚点与根 fd，只复核查过的条目仍以原字节存在且无碰撞别名，再比对文件内容与目录观察。拼写不一致、别名、锚点或 `fstat` 不一致归为来源变化：当前查询与发布报 `PreimageChanged`（`source-observation`），投影把条目路径并入漂移，锚点变化记为 `.`。只有 symlink、`ELOOP` 与非普通文件报 `UnsafePath`。发布先核验后清空列表，写者自身提交不被判为变化。

验收在真实临时目录中进行。快照内祖先或仓库内目录被换成 symlink 或另一真实目录时，下一次读取在读字节前报 `UnsafePath`；叶子在检查与打开之间被换成 symlink 时同样报 `UnsafePath`。只被读取过的目录新增无关文件时，当前查询成功，被扫描过的目录新增成员时报 `PreimageChanged`；写者提交后的核验不报 `PreimageChanged`；Darwin 上发布新建目录成功。仓库根的父目录很宽时，构造之后对仓库根之上的 `readdirSync` 为 0，拼写检查每目录至多枚举一次，构造阶段次数单独计数。

指向仓库外的硬链接与覆盖仓库内目录的挂载不被拒绝；网络文件系统与 overlayfs 上不稳定的 inode 会导致拒绝（[决策依据](../../design/path-safety-cost/DECISION.md)）。

## TypeScript 编译器

解析、诊断与模块解析使用精确固定的 TypeScript 7.1 beta 原生编译器，构建与运行时同一版本，消费者无需全局编译器（[决策依据](../../design/typescript-native/DECISION.md)）。

- `withTypeScript` 是同步词法作用域：按调用栈惰性创建一个 `typescript/sync` API，嵌套调用复用，最外层 finally 关闭。API、AST、snapshot 与 program 不逃逸作用域，不返回 Promise，违反时报 `TypeScriptScopeViolation`；缓存只保存转换后的领域值。纯 AST 操作从 `typescript/ast` 引入。
- API 固定 `runExternalCode: false`，使用包内可执行文件，不接受项目路径覆盖；默认文件系统回调拒绝读写，允许的文件只来自完整的请求虚拟文件系统，不回落到宿主。项目配置与 MDX content mapper 不获得执行权限。
- `withTypeScriptSource` 以只含当前文件的虚拟文件系统提供 SourceFile 与真实语法诊断，结束时先释放 snapshot。`withTypeScriptFiles` 只提供已捕获文件与派生目录，在捕获集合内解析 tsconfig（含 extends）并解析模块，失败保留既有缺口，不读取宿主 tsconfig 或 node_modules。
- p5 在建立 snapshot 前递归捕获静态 import/export、import type、ImportTypeNode 与三斜线相对类型路径，经既有预算与路径校验后固定闭包，解析期间不修改虚拟文件系统；p5 lib 与声明来自固定编译器包与发行包。
- 诊断映射回 `InvalidConfigSyntax`、`CodeParseError` 及依赖与 p5 的既有具名边界，编译器不可用统一为 `TypeScriptUnavailable`；位置按 UTF-16。

## 多语言分析

非 JS/TS 声明从配置范围内独立注释行的标记重建，扫描不声称识别所有语言的字符串语法，也不由符号是否存在决定关系是否存在。符号定位记录安全路径、`range`、`selectionRange`、名称与 profile，是可选观察值，不是关联 ID；缺失或歧义时记 `UnsupportedSymbolBinding` 并定位到标记行（[决策依据](../../design/lsp-integration/DECISION.md)）。

- 绑定：握手与能力核验后按协商编码换算位置。层级 `DocumentSymbol[]`、扁平 `SymbolInformation[]` 与 `null` 分开处理，扁平结果不推导层级。范围须有序、位于当前文本内，`selectionRange` 含于 `range`，子范围含于父范围。从标记块结束处按 profile 跳过允许的空白与前置内容，先选最近起点再选最深声明；仍占同一位置或无法验证时记歧义缺口，不按序号强绑。
- 调用观察：有当前原生绑定与有效范围时从范围内全部可调用声明出发，否则使用文件级并带 `FileScope`。沿安全仓库路径请求 `prepareCallHierarchy` 与 `outgoingCalls`，允许穿过 testRoots 中的转调函数，只在映射实现声明时筛选 sourceRoots；仓库外与不支持文件不展开并记边界缺口。观察总带 `OpenWorldCalls`；空数组、`null` 或全部请求成功都不推导未调用。预算耗尽分别记 `DepthLimit`、`NodeLimit`、`RequestLimit`，非故障截断可发布已有正向观察。
- 输入身份：项目、root、worktree 与 server/profile 构成一个分析单元，`inputs` 覆盖源码与测试成员及字节、Spec、配置、构建与模块配置、server 实现与版本、选项、profile 与算法版本、预算、位置编码，以及所用原生清单、绑定与选择集合。任一变化使整个单元失效，不能只比对声明所在文件。
- 生命周期：启动任何外部进程前取得 runner 所有权并捕获完整输入，随后关闭来源快照与 HawDB 持久句柄；分析与测试收集不并发占用同一 runner。进程组在 Effect Scope 内运行，取消先发协议取消，再平衡关闭文档、`shutdown`、`exit`，超时后 TERM 再 KILL，并核对进程组与输出管道终结。清理成功后用新快照核验成员、摘要、配置、run 失效标记与发布代次，再在短发布协调中写投影。
- 信任：server 是受信程序，进程组管理不是文件或网络沙箱。client 不发 `workspace/executeCommand`，对 `workspace/applyEdit` 回 `applied: false`，其它请求按方法白名单严格解码，配置响应只含显式公开项；凭据与原始环境不进入缓存或诊断。

## 编辑器计算

`concord lsp` 为每个会话维护 URI 到文本、languageId、版本与打开代次的 overlay，未打开的依赖读取受校验磁盘快照，不把历史投影当作当前图。每次任务捕获会话代次、全部依赖的 URI、版本、打开代次与磁盘身份，发布或返回前再次核对，任一变化即丢弃结果并重排；步骤、标记、引用解析与写作检查使用同一版本集合。

每个计算 Job 是包内 `editor-worker.js` 的 Node 子进程，固定 256 MiB heap 上限，由独立 OwnedProcess 进程组持有，原生编译器继承该进程组；项目配置不能替换可执行文件、入口或参数。Job 经 stdin 单个 JSON 输入、stdout 单个 JSON 返回，双方严格解码。每个 Job 有自己的 Scope，收尾后核验进程组归属、清理已检查且后代已消失；缺少清理记录视为未知。未知或失败的清理使会话永久保留 `EditorTaskFailed`，停止新计算，不发布该任务结果。取消的任务在清理结论取得前仍计入运行集合，shutdown、EOF 与 exit 等待全部收尾。Job 不获得来源写权限或 publication lease。

## 原生 adapter

- 绑定：先按 provider 的 group key（项目、文件、声明范围与组身份）归并参数项，不凭同名合并。标记块从首个关联标记到连续元数据末行；自动绑定优先最内层包含标记的唯一 leaf 组，否则取紧随其后的唯一 leaf 组，中间只允许空白及 provider 明确覆盖的注释或装饰器。有普通语句、同深度重叠、缺范围或只有 suite 时不自动绑定。`@native` 与可验证的自动绑定不一致时 `NativeSelectorConflict`，歧义为 `AmbiguousNativeBinding`，二者都是执行前失败，不是 check finding。执行集按 native ID 去重，一次结果可投射到多个关联。
- 输入身份：`inputs` 绑定项目与 root、测试与源码及配置成员集合和字节、fixture、导入支持文件、构建配置、conftest 与 lockfile。它还绑定框架与运行时版本、adapter 真实脚本及传递实现文件、选择能力、算法版本与选中组范围；`node adapter.js` 摘要 adapter.js 而非 node。
- 协调：任何 adapter 进程启动前取得与 runner 相同的 run lease 与失效 epoch，捕获完整快照后关闭来源句柄再运行外部进程；run 所有权贯穿收集、选择、执行、报告与终结，短发布协调不跨外部调用。结束后重读全部输入与成员，有漂移、非零收集退出、截断、缺失调用或清理未知时不发布当前清单，旧清单只作历史展示。
- 报告：每个 run 分配新报告目录，每个 Invocation 独占执行前为空的子目录，以安全目录句柄读取并复核文件身份，读取后变化也拒绝。拒绝 symlink、多重硬链接、特殊文件、目录逃逸与非本次产生的文件；XML 禁止 DTD 与外部实体。目录在最后一个使用者结束后清理，失败保留恢复信息且不发布有效原生结果。

## 文档身份

名称语法、分类根、package 与 leaf 布局及短选择器由同一政策模块定义，严格解析共用 codec。类别由路径决定，名称取正文唯一的一级标题，按 Markdown 语法树识别，代码块中的标题不计；大小写与 Unicode 规范化碰撞按[路径安全](#路径安全)保护。CLI、Web 与页面编辑把选择器解析到实际路径后，冻结路径、类别与完整前像，在租约内重新核对映射，漂移即拒绝；各入口保留自己的错误协议、租约与发布日志，恢复只使用日志中的实际路径（[决策依据](../../design/document-identity/DECISION.md)）。

## 生命周期

### 从接入到 Spec

初始化只在 Git worktree 顶层执行并以冲突即失败保护已有文件。Feature 与 Use Case 建立当前 Spec。Roadmap 采用把目录原子移入 `docs/feature/`：在一个 journal 中写入新路径、改写指向原路径的链接与关系并删除原目录，目标冲突与采用期间的来源变化在提交前拒绝；当前语义转由新 Feature 拥有，采用历史在 Git。

### Issue

Issue 打开时没有 `closure`，关闭时写入；fixed 的 `closure` 带[修复核验](#修复核验)的结论。reopen 删除 `closure`，状态回到 open，之前的结论只在 Git 历史中。`adopts` 只列当前承接的 Spec。

### Memory

Memory 从 captured 开始。decision 与 insight 经 activate 成为 current；note 保持 captured。被新记录替代时成为 superseded，并写 `supersededBy` 或 `supersession`。宪法每次 adopt 与 amend 写一条 `type: decision`、current 的 Memory，以 `amends` 指向受影响的条款与款，见[演进宪法](../project-onboarding/use-case/evolve-constitution.md#amend)。

### 退役与恢复

测试关系用 `@concord-status retired` 明示退役。缓存可随时 clear/rebuild。未完成写入由 recover 根据 journal 恢复；未知编辑导致具名冲突，必须由维护者裁决。

## 信任边界

仓库作者负责 runner 命令及 sourceFiles 声明。摘要能发现声明范围内的漂移，但不证明忽略依赖、外部服务、完整环境或断言充分性。工具不自动触碰生产、远端或凭据。

## 操作依赖

Repository 负责安全读取、配置身份、依赖观察和发布。文档模块决定哪些路径参与当前操作。全局诊断与局部查询共用严格 decoder。局部查询按命令依赖取 owner；全局诊断逐文件保留错误，并传播 `complete: false`。

| 操作 | 内容依赖 | 协调 | 失败范围 |
| --- | --- | --- | --- |
| memory/issue list、index、recall、search | 相应来源内全部候选 owner | 乐观来源 snapshot | 范围内坏记录、来源缺失、配置或事务障碍 |
| show 的 canonical path | 指定 owner | 乐观来源 snapshot | 目标或其必要依赖 |
| show 的短选择器 | 相应类别的全部候选及唯一匹配 owner | 乐观来源 snapshot | 集合不完整或歧义 |
| new | 目标路径与同类短选择器集合 | 独占 publication | 身份冲突、必要依赖或写入资源障碍 |
| memory activate、supersede、link；issue link、unlink、reopen | 指定 owner、当前摘要与关系目标 | 独占 publication | 目标或关系目标缺陷、写入资源障碍 |
| code/test annotate | 每个指定 canonical reference、归属链、类型、anchor；显式 `@issue` 目标 | 乐观来源 snapshot | 指定依赖缺陷，不加载全局 Trace |
| trace、review | 展示的关系图 | 乐观来源 snapshot | 输出 findings；需要完整图的结论拒绝不完整输入 |
| check | 全仓库事实与关联；`--since` 另读基线差异 | 乐观来源 snapshot | 各 owner 解析错误累计为 findings，`ok: false` |
| issue close、roadmap adopt、design decide | 核验与保证关系完整所需的集合 | 独占 publication；fixed 另持 runner 租约 | 保留严格身份、修复核验和逆向关系要求 |

集合查询先按类别的固定目录限定路径，再解码。Feature 与 Use Case 共用 `docs/feature/` 时，同根候选中的坏记录必须报错。Memory 精确路径不需要其它 Memory 内容有效。短选择器读取全部候选，避免隐藏未解码记录中的同名文件。来源扫描使用安全目录读取。

精确引用读取目标和沿路径最近的 README owner 边界。类别由路径决定；Issue、Memory 与宪法的 frontmatter 按各自 Schema 严格解码，Spec 页面没有 frontmatter。缺少唯一一级标题的 owner 不能当作普通页面。最近 owner 的类别不支持附页时拒绝，不向更高祖先回退。精确目标验证类别目录与放置。Use Case 的所属 Feature 由路径推导，该 Feature 的 README 必须存在。`@issue` 目标必须为 Issue。路径安全、目标类型和 anchor 校验保留。

## 完整性诊断

全局诊断 inventory 同时携带 documents、findings 与 complete。单独的 documents 数组不表示集合完整。逐文件收集解码错误，保留错误路径与具名代码，并传播 `complete: false`。关系 show 和 Web workspace 返回 complete 及全部相关完整性诊断。有效记录不能单独证明集合完整。requireValidTrace 同时检查 complete 和 findings。部分图不能把 Issue 关闭为 fixed、采用 Roadmap 或批准关系迁移。

未完成的多文件 journal 仍阻断普通快照。局部解析隔离不持有 publication lease，返回前校验来源观察与发布代次，并在未完成 journal 前停止。读写 access 与 dryRun 的分离、乐观一致性核验和恢复结果见[可移植协调架构](../portable-coordination/architecture.md)。跨功能规则见 [c-013](../../constitution.md#c-013)。
