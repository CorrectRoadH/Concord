# 架构

## 编译管线

Concord 从三处读取事实：Markdown owner、TypeScript AST 可识别的代码声明，以及测试根里的 Concord 标记。工具解析 canonical path 与 anchor，验证目标类型、重复关系和循环，再生成 trace、review 与检查结果。

测试标记不解析宿主测试语法：不核对 runner import，也不把函数名 `test` 当成测试声明。标记的身份只保证当前扫描集合唯一，测试演进由 Git 保存。开发者直接编辑标记并以 Git 审阅；scan 与 check 不改写源文件。

`sourceRoots` 与 `testRoots` 分别控制实现和测试扫描。当前事实门禁的归属、关系和 fixed 判断从当前 Markdown 与当前来源重算，扫描核对前后文件集合及摘要。诊断历史投影按[异步查询 Spec](../local-data-engine/use-case/query-asynchronous-projections.md)保存，带构建时间，不授权当前裁决。

两类扫描结果可以缓存在可删除的 HawDB 投影中，命中都严格解码：

- 代码声明解析按文件缓存，键包含项目目录、解析器身份、路径和字节摘要。摘要不符、损坏或写入失败时回源。
- 测试投影按整次扫描缓存。身份包含项目目录的 root 与 privateDir、测试与源码目录、runner 配置、完整路径集合、每文件字节摘要和解析器身份；任何一项变化、文件改名删除或缓存损坏时，从源码重建。

未改动的配置解析可以命中同一库，使后续命令不加载 TypeScript 编译器。

同次关系图编译复用相同引用与目标类型的解析结果。读取的目标及 README 边界在返回前逐一复核字节和安全路径；变化或复核失败时保留 finding，不能返回完整图。临时引用结果随本次编译结束释放，不跨请求保存。

Trace 与定向 Review 按 owner 汇总 Feature supporting page 与 Use Case 的测试关系，保留 exact path 与 anchor，不用目录前缀混入相邻 Feature。默认输出供人阅读，`--json` 输出结构化结果。

## 入口与命令加载

编译后的 CLI 对精确匹配的 `--help`、`-h`、`--version`、`-v` 使用内嵌输出，不加载命令或原生产物。

构建时从正式源码 CLI 捕获 stdout、stderr 与退出码，随可执行文件冻结。只在 NO_COLOR=1、TERM=dumb、未设置 FORCE_COLOR 且输入输出均非 TTY 时使用；其它调用交给同一正式解析器。编译规则见[编译入口](../../engineering/build/architecture.md#编译入口)。

源码 CLI 直接使用正式解析器。`--skill` 读取随包指南；命令与内部 worker 都在编译可执行文件内，不加载外置启动 JavaScript。


## 自举

本项目的实现文件与关键函数直接声明各自的 Feature / Use Case。共享基础模块关联 Feature，具体行为关联各条 Use Case；注释渲染使用显式 region。

selfhost 验收要求每条 Use Case 都存在真实实现和测试关联。源码旁的声明仍是唯一 owner，不另存模块到功能的映射表。

## 执行管线

只有 `test run`、`test verify` 与 `issue close --fixed` 启动仓库命令。

runner 在消费者 cwd 下执行。argv 逐参数替换 `{file}`、`{name}`、`{pattern}`，不经过 shell。timeout、取消和输出上限都由受 Scope 管理的进程组清理。

运行结果记录 command outcome 与 observed execution，结果不持久化。执行数量为 unknown，或由默认 Node TAP 计数观察为 nonzero、zero、skipped。信号终止或启动失败不记为通过；未知或全跳过不会被包装成 case passed。

`code analyze` 启动的 language server、adapter 收集与测试执行共用同一套 runner 进程所有权和清理。

## 修复核验

只支持线性路径：先提交会失败的回归测试，再提交修复。可观察行为见[核验修复并关闭缺陷](use-case/resolve-with-command-evidence.md)。

1. 回归测试由 `@issue` 标记选出，`@status retired` 的标记不能用于修复核验。修复提交默认是核验开始时的 HEAD，`--fix` 可以指定其 first-parent 历史中缺陷提交之后的提交。worktree 中他人的未提交改动不参与核验，只要求该 Issue 文件没有未提交改动。
2. 缺陷提交默认是 HEAD 的 first-parent 历史中最早出现这些回归测试的提交；`--defect` 必须是 HEAD 的 first-parent 祖先。
3. 从缺陷提交到修复提交之间，测试文件、`runner.sourceFiles` 与测试指向的 Spec 字节不变；严格解码后的项目配置除 `runner.prepare` 外不变，配置文件的空白与格式不参与比较。区间中有 merge 提交时不支持。
4. 以 detached worktree 分别检出缺陷提交与修复提交。它们位于系统临时目录下属于当前用户、权限 0700 的私有目录中，在仓库目录树之外，不跟随符号链接。放在仓库之外，是因为仓库之下的 worktree 解析依赖时会向上找到主 worktree 的依赖，使构建结果不同于干净的 worktree。

   每个临时 worktree 先依次执行 `runner.prepare` 的命令（例如安装依赖与构建），再运行回归测试。回归测试所在文件被某个 `testAdapters` 覆盖时，按 `test run --require-native` 的同一条原生选择路径运行，两端都必须是 green 或 red，任一端 invalid 时核验以 `FixUnverifiable` 结束；没有被覆盖时运行 runner。`prepare` 只准备环境：两个 worktree 都取核验开始时 HEAD 的配置，重放同样取当时 HEAD 的配置。它不属于第 3 步的冻结输入，因此早于它出现的提交也能核验。

   准备命令以非零码结束、超时或清理未知时，核验报 `FixUnverifiable`，不计为 red。全部命令在 runner 租约与 OwnedProcess 下执行，结束后删除临时 worktree；清理无法确认时按 runner 阻断处理。
5. 缺陷提交上同一冻结命令以非零码结束，修复提交上以零结束。command runner 不区分断言失败与构建失败，red 只表示该命令的非零结果。零执行、全部跳过、取消、信号终止或清理未知的运行不计为 red 或 green。缺测试、缺提交（含 shallow clone）与超时是 `FixUnverifiable`。
6. 发布前重新核对 Issue 文件与回归测试文件的前像，变化则拒绝。同一次发布删除 Issue 文件，并删除回归测试源码中指向它的 `@issue` 行；测试本身与其它标记保留。输出的结论包含缺陷与修复提交、按测试关联 ID 列出的回归测试、runner 配置摘要与执行它的 Concord 版本，供写进提交说明。

修复核验从当前源码重新构建，不信任缓存的状态判断。

`test verify --defect <D> --fix <F> <test-id>...` 在 D 与 F 的临时 worktree 上重放，核对结论的主张：回归测试在 D 上失败、在 F 上通过。之后的提交改动测试、runner 输入或 Spec 不使这个结论失效，之后的回归由完整测试发现。提交、依赖或运行环境不可获得时报告无法重放。

## 写入管线

文档 mutation 在取得[发布租约](../portable-coordination/concepts.md#publication-lease)后按以下顺序执行：

1. 校验 canonical relative path、每个 symlink 组件与完整前像。
2. 把全部计划变更写入绑定 root 与 privateDir 的 journal。
3. 以同文件系统临时文件和原子 rename 逐个发布文件。
4. 全部提交后才刷新可重建缓存。

读取遇到未完成的 journal 时，先看它的发布租约：写入者仍持有租约，说明发布正在进行，读取等这次发布结束后再读，等待以该写入自身的期限为界；没有存活的租约持有者，说明发布已中断，读取返回 `RecoveryRequired`，要求显式 recover。内容既不匹配前像也不匹配 planned digest 时，拒绝覆盖外部编辑。

命令助手与 Web 保存都走这条管线。Web 保存以整文件摘要作为前像；源码保存只替换配置范围内既有的 JS/TS 文件，使用完整文件摘要与受限恢复日志。

人与 agent 的直接编辑不经过这条管线，由 `concord check` 检查（[操作依赖](#操作依赖)）。

新增配置、来源和写入口必须同时定义资源所有权与恢复授权，写入的可观察保证见[写入保护](use-case/recover-local-state.md#写入保护)。

## 步骤改写的发布

`use-case format` 沿用正文编辑的前像与发布协议。

`rename-step` 在唯一 journal 与发布租约下使用专用 `step-rename` 授权范围，不串联多次 `source.set` 或文档发布。该范围绑定项目、worktree、冻结配置、Use Case 路径、old-id、new-id、完整文件前后像、摘要与 mode，以及规划时观察的目录成员。

`issue close` 使用专用的 `issue-close` 授权范围：在唯一 journal 与发布租约下删除 Issue 文件，并从回归测试源码中删除指向它的 `@issue` 行。

- 规划在 `app` 中完成，由测试领域的标记解析器找出这些行。
- 该范围绑定项目、worktree、冻结配置、测试成员集合、Issue 路径、每个被改文件的完整前后像、摘要与 mode。
- 发布与恢复时经 `PublicationValidation` 以冻结输入重新规划，只接受完全相同的写集：每个测试文件的后像必须恰好等于前像删去这些 `@issue` 行，其余字节不变。
- 重新规划结果不同、前像不符或无法解码时，保留 journal 并阻断写入。

`move` 使用专用的 `document-move` 授权范围，在唯一 journal 与发布租约下完成全部移动与改写：

- 规划在 `app` 中完成。Markdown 链接改写与 `roadmap start` 共用同一个链接重定位模块；测试标记与代码声明分别由测试领域与代码声明的解析器找出目标，只替换目标路径的字节范围。
- 该范围绑定项目、worktree、冻结配置、源与目标路径、被移动的文件集合、测试根与源码根的成员集合，以及每个被改文件的完整前后像、摘要与 mode。
- 发布与恢复时经 `PublicationValidation` 以冻结输入重新规划，只接受完全相同的写集；重新规划结果不同、前像不符或无法解码时，保留 journal 并阻断写入。
- `unmanagedReferences` 只在规划时扫描并报告，不进入写集，也不参与重新规划的比较。

规划在同一次来源快照中记录引用扫描所需的文件、目录成员和受管引用检查；受管引用经领域读取能力检查，不直接读取 owner 文件。提交取得短期独占租约，复核配置、全部观察与完整变更集，沿用 runner 失效和隔离检查。

正常发布与恢复共用范围校验：从前像复算允许的改写，拒绝超出授权的后像（[写入保护](use-case/recover-local-state.md#写入保护)）。

## 代码声明

代码声明标记有三种 scope：

- 文件头的 `@concord-file`；
- 紧邻完整 AST 节点的 `@concord-code`；
- 同一 statement-list 内连续语句的 `@concord-begin/end`。

范围标记无参数。一个 scope 最多一份声明，多目标通过相邻的 implements 表达。

`@concord-code` 可以绑定的 node 是：有 body 的函数声明与方法、类声明，以及单 identifier 且直接以 arrow 或 function 为 initializer 的变量语句。region 不嵌套、不截断表达式、不跨语句列表，可以包含完整函数。查询返回全部包含关系，不推断覆盖或继承。

绑定与孤立标记诊断消费真实 TS comment ranges，不从纯文本行认领字符串、模板、正则或 JSX 中的伪标记。含真实代码标记且有语法错误的文件不产生有效声明。起始块内 implements 必须连续相邻，语法与位置规则见[使用指引](../../../skills/concord/references/code.md)。

目标支持 Feature、Use Case 与 Engineering，沿用 owner、supporting page 与 anchor 解析，只拒绝重复 exactRef。反查时 Feature 汇总自身与 Use Case，Engineering 汇总自身与附页；结果按自动引用去重，保留匹配的 exactRefs。

`sourceRoots` 默认为存在的 `src/`，配置后替换默认值，沿用安全路径验证。只扫描显式根内的 JS/TS，允许与 testRoots 重叠。`sourceIgnore` 按[发现 Spec](use-case/discover-annotated-tests.md)缩小源码与测试自动发现范围；它参与快照身份，扫描、复核与监听共用同一匹配规则。

`code marker` 与对应 action 不接收或返回 ID，在来源快照中验证指定 canonical reference、归属链、类型和 anchor。`code list` 与 `code at` 提供声明查询。Web 以符号、位置和显式关联呈现实现。无效 begin 仍参与边界检查，普通扫描不写源码。

代码错误阻断 code、check、trace、review 与 doctor。test list、show、run 与 verify 不包含代码投影，保留全部文档与测试关系校验；修复核验的输入不包含 code 引用。

## 代码声明引用

引用表示当前位置，不是永久身份、CAS 或授权；稳定边界见[引用的稳定性](use-case/trace-code-ownership.md#引用的稳定性)。

JS/TS 代码声明的 `id` 与 `code:<id>` 边为 `code-` 加 `JSON.stringify(["concord.code-reference/v1", relativePath, scope, locator])` 的 SHA-256 前 32 个十六进制字符，不含行号、正文、关联目标或绝对路径。

- file 的 locator 为空数组。
- node 的 locator 从 SourceFile 的子节点到绑定节点，每层为 `[SyntaxKind 字符串, staticName 或 null, 同描述直接兄弟的零基序号]`；直接子节点完整枚举，包含未标注节点。
- staticName 只取 Identifier、PrivateIdentifier、StringLiteral、NumericLiteral 的文本；ComputedPropertyName 与无名节点为 null，不读取或求值表达式。单变量语句取唯一变量声明的简单标识符。
- region 的 locator 为 `[statementListLocator, validRegionOrdinal]`。SourceFile 的列表路径为空，序号按该列表内合法 region 的源码顺序从零开始。

其它语言的声明引用由 `concord.code-marker/v1`、canonical 路径与文件内标记块序号派生。改变派生语义必须升级版本。

## 路径安全

仓库路径解析分两个入口：

- **完整检查**：从文件系统根逐级核对 Darwin 字节拼写，并 `lstat` 拒绝 symlink，不读取任何复用信息。写入、建目录与删除、原子替换、journal、发布 preflight 与 apply、恢复、`discoverRoot`、`init`，以及构造期的 privateDir 与 journal 检查使用它。
- **读取检查**：只读快照内的文件读取与目录扫描使用它，写入前像同样经读取检查取得（[写入保护](use-case/recover-local-state.md#写入保护)）。

**根锚点**：仓库对象构造时对根做一次完整检查，记录从 `/` 到根每一级的 bigint `dev`/`ino`。快照深度 0→1 时打开根目录 fd 并与锚点比对，回到 0 时关闭。

**读取检查**在读字节前完成：逐级 `lstat` 核对锚点 inode，不枚举仓库根之上的目录；仓库内组件先做拼写核对，再 `lstat` 拒绝 symlink。

文件以不跟随 symlink 的方式打开：

- Darwin 用 `O_NOFOLLOW_ANY`，要求 macOS 11 及以上，否则构造以 `UnsupportedHost` 失败。
- Linux 用 `O_NOFOLLOW`，并以 `/proc/self/fd/<fd>` 比对期望路径，不可用时拒绝读取。

打开后 `fstat` 须为普通文件。大小或 `dev`/`ino` 与最后一次 `lstat` 不一致时，按来源变化报 `SourceChanged`；它在投影刷新中是可重试漂移，不返回部分值。

**快照内目录列表**：拼写核对复用本次快照的目录列表，并记录实际查过的 `dir/segment`。每次目录成员扫描都新鲜枚举，不复用拼写列表作为成员集合。列表不跨快照、不跨进程、不按时间失效；嵌套快照共享外层结构，任何自身写入开始前清空（[性能约束](../../engineering/performance/README.md#性能约束)）。

**结束核验**在三处执行：当前快照核验、投影漂移收集和发布前观察校验。它使用只供本次核验的新列表，重新核对锚点与根 fd，只复核查过的条目仍以原字节存在且无碰撞别名，再比对文件内容与目录观察。

结束核验的结果这样分类：

- 拼写不一致、别名、锚点或 `fstat` 不一致归为来源变化：当前查询与发布报 `FileChangedSinceRead`（`source-observation`），投影把条目路径并入漂移，锚点变化记为 `.`。
- 只有 symlink、`ELOOP` 与非普通文件报 `UnsafePath`。

这些检查只作用于 Concord 读写的路径：docs、memory、配置声明的源码与测试根、Concord 写入的配置与 skill 目录。目录扫描在这些路径之外遇到 symlink（例如使用者自己链接的 `CLAUDE.md` 或 `.claude/skills/<名称>`）时，不跟随、不读取，也不使检查失败；Concord 写入的 skill 目录内出现 symlink 仍报 `UnsafePath`。
- 发布先核验后清空列表，写者自身提交不被判为变化。

验收在真实临时目录中进行：

- 快照内祖先或仓库内目录被换成 symlink 或另一真实目录时，下一次读取在读字节前报 `UnsafePath`；叶子在检查与打开之间被换成 symlink 时同样报 `UnsafePath`。
- 只被读取过的目录新增无关文件时，当前查询成功；被扫描过的目录新增成员时报 `FileChangedSinceRead`。
- 写者提交后的核验不报 `FileChangedSinceRead`；Darwin 上发布新建目录成功。
- 仓库根的父目录很宽时，构造之后对仓库根之上的 `readdirSync` 为 0，拼写检查每目录至多枚举一次，构造阶段次数单独计数。

指向仓库外的硬链接与覆盖仓库内目录的挂载不被拒绝；网络文件系统与 overlayfs 上不稳定的 inode 会导致拒绝。

## TypeScript 编译器

解析、诊断与模块解析使用精确固定的 TypeScript 7.1 beta 原生编译器，构建与运行时同一版本，消费者无需全局编译器。

- 产品使用官方 `typescript/async`。`withTypeScript`、`withTypeScriptFiles` 与 `withTypeScriptSource` 返回 Promise，回调允许值或 Promise。`withTypeScript` 用 AsyncLocalStorage 隔离调用链并惰性取得 API；同链嵌套复用，独立并发调用互不借用。`withTypeScriptFiles` 总是独立捕获作用域。关闭后访问 API 报 `TypeScriptScopeViolation`，包括已提取的方法；所有子调用必须等待 settle 后才关闭作用域。API、AST、snapshot 与 program 不逃逸，缓存仅保存投影后的领域值。纯 AST 操作仍从 `typescript/ast` 同步执行。
- API 固定 `runExternalCode: false`，使用包内可执行文件，不接受项目路径覆盖。默认文件系统回调拒绝读写，允许的文件只来自完整的请求虚拟文件系统，不回落到宿主。项目配置与 MDX content mapper 不获得执行权限。
- `withTypeScriptSource` 等待只含当前文件的虚拟快照、SourceFile 与真实语法诊断；领域投影结束后逆序 await snapshot、解析租约和 API 的释放。官方 close 只证明会话关闭，进程退出由进程 owner 另行确认。已有领域主失败保留其错误码，释放失败写入同一错误的 cleanup 诊断；无主失败而清理失败为 TypeScriptUnavailable，不能报告成功。任何单项释放失败都不能阻止其余释放尝试。
- `withTypeScriptFiles` 只提供已捕获文件与派生目录，在捕获集合内解析 tsconfig（含 extends）并解析模块。失败保留既有缺口，不读取宿主 tsconfig 或 node_modules。
- p5 在建立快照前递归捕获静态 import/export、import type、ImportTypeNode 与三斜线相对类型路径，经既有预算与路径校验后固定闭包，解析期间不修改虚拟文件系统。p5 lib 与声明来自固定编译器包与发行包。
- 配置解析、代码/测试声明分析、依赖分析与 p5 调用链显式 await 编译结果。Effect 边界等待拥有资源的 Promise 完成再释放外层 scope，不允许 Effect 产出未完成的 Promise receipt。
- 内容缓存的异步方法只在 miss 时等待 parser，保持输入顺序和逐文件失败语义；命中不启动编译器，失败不缓存。跨 await 只保留领域值与待写行，写入时重新取得有效 cache handle，不保留可能被 owner 淘汰的 native handle。
- `PersistentCache.withView` 及 analysis reader 的借用绑定持续到异步回调 settle；成功、失败和取消均先完成 callback 收尾，再解绑 cache/来源。
- `LocalRepository.open` 是异步工厂；返回前验证配置并归还初始化 FD、lease 与缓存资源，成功返回不代表已有活动 snapshot。写工厂仍要求 publication validation 能力，不公开未初始化对象。
- 诊断映射回 `InvalidConfigSyntax`、`CodeParseError` 及依赖与 p5 的既有具名边界，编译器不可用统一为 `TypeScriptUnavailable`；位置按 UTF-16。

## 多语言分析

非 JS/TS 声明从配置范围内独立注释行的标记重建。扫描不声称识别所有语言的字符串语法，也不由符号是否存在决定关系是否存在。

符号定位记录安全路径、`range`、`selectionRange`、名称与 profile，是可选观察值，不是关联 ID。缺失或歧义时记 `UnsupportedSymbolBinding`，并定位到标记行。

**绑定**：握手与能力核验后，按协商编码换算位置。

- 层级 `DocumentSymbol[]`、扁平 `SymbolInformation[]` 与 `null` 分开处理，扁平结果不推导层级。
- 范围须有序、位于当前文本内，`selectionRange` 含于 `range`，子范围含于父范围。
- 从标记块结束处按 profile 跳过允许的空白与前置内容，先选最近起点，再选最深声明。仍占同一位置或无法验证时记歧义缺口，不按序号强绑。

**调用观察**：

- 有当前原生绑定与有效范围时，从范围内全部可调用声明出发；否则使用文件级并带 `FileScope`。
- 沿安全仓库路径请求 `prepareCallHierarchy` 与 `outgoingCalls`。允许穿过 testRoots 中的转调函数，只在映射实现声明时筛选 sourceRoots；仓库外与不支持的文件不展开，记边界缺口。
- 观察总带 `OpenWorldCalls`；空数组、`null` 或全部请求成功都不推导未调用。
- 预算耗尽分别记 `DepthLimit`、`NodeLimit`、`RequestLimit`，非故障截断可发布已有正向观察。

**输入身份**：项目、root、worktree 与 server/profile 构成一个分析单元。`inputs` 覆盖源码与测试成员及字节、Spec、配置、构建与模块配置、server 实现与版本、选项、profile 与算法版本、预算、位置编码，以及所用原生清单、绑定与选择集合。任一变化使整个单元失效，不能只比对声明所在文件。

**生命周期**：

1. 启动任何外部进程前，取得 runner 所有权并捕获完整输入，随后关闭来源快照与 HawDB 持久句柄。分析与测试收集不并发占用同一 runner。
2. 进程组在 Effect Scope 内运行。取消时先发协议取消，再平衡关闭文档、`shutdown`、`exit`；超时后 TERM 再 KILL，并核对进程组与输出管道终结。
3. 清理成功后，用新快照核验成员、摘要、配置与 run 失效标记，并确认没有未完成的 journal，再在短发布协调中写投影。

**信任**：server 是受信程序，进程组管理不是文件或网络沙箱。client 不发 `workspace/executeCommand`，对 `workspace/applyEdit` 回 `applied: false`，其它请求按方法白名单严格解码。配置响应只含显式公开项；凭据与原始环境不进入缓存或诊断。

## 编辑器计算

`concord lsp` 为每个会话维护 URI 到文本、languageId、版本与打开标识的 overlay。未打开的依赖读取受校验磁盘快照，不把历史投影当作当前图。

每次任务捕获会话标识、全部依赖的 URI、版本、打开标识与磁盘身份，发布或返回前再次核对；任一变化即丢弃结果并重排。步骤、标记、引用解析与写作检查使用同一版本集合。

每个计算 Job 是固定 Bun 的 editor worker，由独立 OwnedProcess 进程组持有，编译器 supervisor 与原生编译器继承该进程组。editor 不设置进程内存上限，不因 RSS 大小终止计算；输入、输出与时间预算继续独立强制。项目配置不能替换可执行文件、入口或参数。Job 经 stdin 接收单个 JSON 输入、经 stdout 返回单个 JSON，双方严格解码。

每个 Job 有自己的 Scope，收尾后核验进程组归属、清理已检查且后代已消失；缺少清理记录视为未知。

- 未知或失败的清理使会话永久保留 `EditorTaskFailed`，停止新计算，不发布该任务结果。
- 取消的任务在清理结论取得前仍计入运行集合；shutdown、EOF 与 exit 等待全部收尾。
- Job 不获得来源写权限或发布租约。

## 原生 adapter

项目测试运行时与 Concord 内部角色分开。内置 Node test 和 Vitest 的版本查询与项目执行从项目环境的 PATH 选择 `node`；Vitest 收集角色由 Concord 自身启动，并从显式项目根加载框架。编译后的 `process.execPath` 不能用于解释任意项目 JavaScript。adapter 实现身份绑定源码或实际编译程序，运行时身份绑定实际项目命令。

**绑定**：先按 provider 的 group key（项目、文件、声明范围与组身份）归并参数项，不凭同名合并。

- 标记块从首个关联标记到连续元数据末行。
- 自动绑定优先最内层包含标记的唯一 leaf 组，否则取紧随其后的唯一 leaf 组；中间只允许空白及 provider 明确覆盖的注释或装饰器。
- 有普通语句、同深度重叠、缺范围或只有 suite 时不自动绑定。
- `@native` 与可验证的自动绑定不一致时报 `NativeSelectorConflict`，歧义报 `AmbiguousNativeBinding`；二者都是执行前失败，不是 check finding。
- 执行集按 native ID 去重，一次结果可投射到多个关联。

**输入身份**：`inputs` 绑定项目与 root、测试与源码及配置成员集合和字节、fixture、导入支持文件、构建配置、conftest 与 lockfile。它还绑定框架与运行时版本、adapter 真实脚本及传递实现文件、选择能力、算法版本与选中组范围；`node adapter.js` 摘要 adapter.js 而非 node。

**协调**：任何 adapter 进程启动前，取得与 runner 相同的运行租约与失效标记，捕获完整快照后关闭来源句柄，再运行外部进程。run 所有权贯穿收集、选择、执行、报告与终结，短发布协调不跨外部调用。

结束后重读全部输入与成员。有漂移、非零收集退出、截断、缺失调用或清理未知时不发布当前清单，旧清单只作历史展示。

**报告**：每个 run 分配新报告目录，每个 Invocation 独占一个执行前为空的子目录。文件以安全目录句柄读取并复核身份，读取后变化也拒绝。

- 拒绝 symlink、多重硬链接、特殊文件、目录逃逸与非本次产生的文件；XML 禁止 DTD 与外部实体。
- 目录在最后一个使用者结束后清理；清理失败时保留恢复信息，不发布有效原生结果。

## 文档身份

名称语法、分类根、package 与 leaf 布局及短选择器由同一政策模块定义，严格解析共用 codec。类别由路径决定；名称取正文唯一的一级标题，按 Markdown 语法树识别，代码块中的标题不计。大小写与 Unicode 规范化碰撞按[路径安全](#路径安全)保护。

CLI、Web 与页面编辑把选择器解析到实际路径后，冻结路径、类别与完整前像，在租约内重新核对映射，漂移即拒绝。各入口保留自己的错误协议、租约与发布日志，恢复只使用日志中的实际路径。

## 生命周期

### 从接入到 Spec

初始化只在 Git worktree 顶层执行，子目录项目与 bare repo 明确拒绝；冲突即失败，以保护已有文件。Feature 与 Use Case 建立当前 Spec。

Roadmap 采用把目录原子移入 `docs/feature/`，规则见[采用 Roadmap](use-case/plan-and-adopt-contracts.md)。

- 在一个 journal 中写入新路径、改写指向原路径的链接与关系，并删除原目录。
- 集合内的相对链接改写，集合外链接保持原目标。
- 目标冲突与采用期间的来源变化在提交前拒绝。
- 当前语义转由新 Feature 拥有，采用历史在 Git。

### Issue

Issue 只表示还要处理的问题；`issue close` 执行需要的步骤后删除文件，fixed 先经过[修复核验](#修复核验)。`spec` 关系只列这个 Issue 当前涉及的 Spec。

### Memory

Memory 没有生命周期状态，过时就改写或删除，历史在 Git。

### 退役与恢复

测试关系用 `@status retired` 明示退役。缓存可随时 clear/rebuild。未完成写入由 recover 根据 journal 恢复；未知编辑导致具名冲突，必须由维护者裁决。

## 独立与本地

核心流程不需要账号、模型 API 或云服务。

- Concord 作为独立安装的程序工作，只需要本地 Git 仓库，不依赖其它仓库的 worktree、全局安装、provider 凭据或部署服务。
- 可选外部接入必须有明确边界，不成为基础本地流程的前提。
- 本地 Issue 不依赖外部服务。远端写入需单独授权，本地操作不自动投射为远端变更。
- Concord 不自动发版、push、调用付费模型或操作远端 Issue。

## 信任边界

仓库作者负责 runner 命令及 sourceFiles 声明。摘要能发现声明范围内的漂移，但不证明忽略依赖、外部服务、完整环境或断言充分性。工具不自动触碰生产、远端或凭据。

## 操作依赖

Repository 负责安全读取、配置身份、依赖观察和发布，文档模块决定哪些路径参与当前操作。全局诊断与局部查询共用严格 decoder：局部查询按命令依赖取 owner，全局诊断逐文件保留错误并传播 `complete: false`。

| 操作 | 内容依赖 | 协调 | 失败范围 |
| --- | --- | --- | --- |
| list memory、list issue、memory search、issue search | 相应来源内全部候选 owner | 乐观来源快照 | 范围内坏记录、来源缺失、配置或事务障碍 |
| show 的 canonical path | 指定 owner | 乐观来源快照 | 目标或其必要依赖 |
| show 的短选择器 | 相应类别的全部候选及唯一匹配 owner | 乐观来源快照 | 集合不完整或歧义 |
| new | 目标路径与同类短选择器集合 | 独占 publication | 身份冲突、必要依赖或写入资源障碍 |
| memory link；issue link、unlink、close | 指定 owner、当前摘要与关系目标 | 独占 publication | 目标或关系目标缺陷、写入资源障碍 |
| code/test marker | 每个指定 canonical reference、归属链、类型、anchor；显式 `@issue` 目标 | 乐观来源快照 | 指定依赖缺陷，不加载全局 Trace |
| trace、review | 展示的关系图 | 乐观来源快照 | 输出 findings；需要完整图的结论拒绝不完整输入 |
| check | 全仓库事实与关联 | 乐观来源快照 | 各 owner 解析错误累计为 findings，`ok: false` |
| issue close、roadmap start | 核验与保证关系完整所需的集合 | 独占 publication；fixed 另持 runner 租约 | 保留严格身份、修复核验和逆向关系要求 |

集合查询先按类别的固定目录限定路径，再解码。

- Feature 与 Use Case 共用 `docs/feature/` 时，同根候选中的坏记录必须报错。
- Memory 精确路径不需要其它 Memory 内容有效。
- 短选择器读取全部候选，避免隐藏未解码记录中的同名文件。
- 来源扫描按当前配置和安全目录读取，文件名不推导作者 ID。

精确引用读取目标和沿路径最近的 README owner 边界。类别由路径决定；Issue、Memory 与品味的 frontmatter 按各自 Schema 严格解码，Spec 页面没有 frontmatter。

- 缺少唯一一级标题的 owner 不能当作普通页面。
- 最近 owner 的类别不支持附页时拒绝，不向更高祖先回退。
- 精确目标验证类别目录与放置。Use Case 的所属 Feature 由路径推导，该 Feature 的 README 必须存在。
- `@issue` 目标必须为 Issue。路径安全、目标类型和 anchor 校验保留。

## 完整性诊断

全局诊断 inventory 同时携带 documents、findings 与 complete；单独的 documents 数组不表示集合完整。逐文件收集解码错误，保留错误路径与具名代码，并传播 `complete: false`。

关系 show 和 Web workspace 返回 complete 及全部相关完整性诊断。有效记录不能单独证明集合完整。requireValidTrace 同时检查 complete 和 findings。部分图不能把 Issue 关闭为 fixed、采用 Roadmap 或批准关系迁移。

未完成的多文件 journal 仍阻断普通快照。局部解析隔离不持有发布租约，返回前重新核对读过的文件摘要与目录集合，遇到未完成的 journal 时停止。

读写 access 与 dryRun 的分离、乐观一致性核验和恢复结果见[可移植协调架构](../portable-coordination/architecture.md)。跨功能规则见[操作依赖与发布协调](../../architecture.md#操作依赖与发布协调)。

## 私有状态

Git-private 目录由 `git rev-parse --git-path concord` 定位，其中的 HawDB 缓存、journal、runner 租约与修复核验的临时 worktree 属于当前 worktree。普通单 worktree 仓库通常落在 `.git/concord`，linked worktree 则使用自己的 Git-private 路径。

缓存可清除重建；journal 只用于安全恢复，不取代 Markdown 或测试源码。私有目录中的其它文件不被读取，也不被删除。

## 解码与路径边界

所有不可信 JSON、YAML 和缓存内容必须严格解码。路径拒绝绝对路径、traversal 与 symlink 逃逸，读取检查的实现见[路径安全](#路径安全)。修复核验只证明 runner 在两个提交上的退出结果，不继承任何产品专属 E2E 可靠性声明。


编译器会话由固定的 TypeScript supervisor 持有，官方 `tsserverPath` 只指向此入口；安装模式在同一可执行文件识别严格的 `--api --async` 参数，源码模式按源码、锁、Bun 与目标身份惰性编译外部缓存中的最小入口。源码准备有 120 秒期限。supervisor 只启动包内固定 native executable，关闭 external mapper，标准流透明转发并使用背压，不累积或截断 RPC。

supervisor 和 native 均继承调用者的进程组，不再建立可逃逸的 native 组；只用专属新 pipes 连接 native 的 stdin/stdout，不继承 supervisor 的协议 fd 或 IPC。会话总期限 600 秒，父 stdin EOF、TERM/INT 或期限触发幂等停止：停止 relay、关闭 native stdin、TERM、500ms 后必要时 KILL，再等待自有 child close。不对继承组发信号。异常收尾中止背压等待，不伪造响应；外层进程组回收仍验证整体退出。

固定 TypeScript 7.1.0-beta 使用锁文件记录的 Bun 安装补丁：官方 JSON-RPC connection 关闭时 dispose connection，保证初始化和在途请求拒绝；不复制 RPC、不读取私有 client 字段、不在运行时改写依赖。补丁字节参与依赖与构建身份，所有来源和归档使用同一补丁。
