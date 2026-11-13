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

核验需要两份快照：有回归测试而没有修复的红快照，与两者都有的绿快照。快照有两种取得方式。

- **两个提交**：先提交会失败的回归测试，再提交修复。红快照是缺陷提交，绿快照是修复提交。可观察行为见[核验修复并关闭缺陷](use-case/resolve-with-command-evidence.md)，下面的编号规则描述这条路径。
- **推导**：测试与修复在同一份改动里（暂存区，或一个提交）。红快照是改动的基底加上其中位于 `testRoots` 之下的部分，绿快照是基底加上全部改动。
  可观察行为见[一次提交核验小修复](use-case/verify-fix-in-one-commit.md)。推导出的快照是 Git tree 对象，经临时提交对象检出到临时 worktree；
  不写入任何引用，不修改暂存区与工作目录，核验结束后这些对象不被任何引用持有。

两种方式共用同一套依赖复用、冻结输入核对、运行与诊断规则，差别只在快照从哪里来、被核验的测试如何选出。
推导方式选出的是改动中新增或正文有变化的测试用例，不依赖 `@issue`。

1. 回归测试由 `@issue` 标记选出，`@status retired` 的标记不能用于修复核验。修复提交默认是核验开始时的 HEAD，`--fix` 可以指定其 first-parent 历史中缺陷提交之后的提交。只要求该 Issue 文件与回归测试文件没有未提交改动。
2. 缺陷提交默认是 HEAD 的 first-parent 历史中最早出现这些回归测试的提交；`--defect` 必须是 HEAD 的 first-parent 祖先。
3. 从缺陷提交到修复提交之间，回归测试文件与测试指向的 Spec 字节不变；严格解码后的 runner 命令配置不变。
4. 在工作区服务管理的轻量临时 worktree 中分别检出缺陷提交与修复提交，直接复用主 worktree 已安装的依赖，无需配置或执行单独的 `prepare` 命令，也不维护手工 `sourceFiles` 清单。

   复用的对象是主 worktree 中全部已安装依赖目录：被 Git 忽略、名为 `node_modules` 或 `.venv`、且不位于另一个这样的目录之内的目录。
   每个目录按相同的相对路径链接进临时 worktree；该提交的检出中不存在其父目录时跳过。只链接仓库根的那一个不够：
   包管理器的 workspace 在每个成员包下各有一个依赖目录，缺少它们时运行器会在启动前失败或试图重新安装。
   构建产物、缓存与其它被忽略的文件不链接，它们属于主 worktree 的当前提交，带进历史提交会让缺陷提交跑到修复后的代码。

   复用只在依赖没有变化时成立。被核验提交中的依赖锁文件与主 worktree 的同名文件字节不同时，核验以 `FixUnverifiable` 结束并指出该文件，
   不在与该提交不符的依赖上运行。锁文件指所选 `testAdapters` 声明的 `lockFiles`，以及仓库中存在的
   `pnpm-lock.yaml`、`package-lock.json`、`yarn.lock`、`bun.lock`、`bun.lockb`、`uv.lock` 与 `poetry.lock`。

   借来的依赖目录属于主 worktree，核验不得改动它。链接不提供这层保护：包管理器在临时 worktree 里安装或清理时，
   写入会顺着链接落到主 worktree。pnpm 11 就是这样：它把项目的绝对路径写在安装状态里，换了目录即认为 workspace 变了，
   `pnpm exec` 默认先重装，重装前清空的正是主 worktree 的 `node_modules`。Concord 用三层规则挡住它：

   - **不让包管理器自动安装。** 核验中由 Concord 启动的每个进程都带 `CONCORD_VERIFICATION=1`，以及让包管理器跳过运行前依赖检查的开关：
     `pnpm_config_verify_deps_before_run=false` 与 `npm_config_verify_deps_before_run=false`。项目自己的脚本可以读
     `CONCORD_VERIFICATION` 来跳过安装步骤。Concord 不设置 `CI`，也不关闭包管理器的确认提示。
   - **进程没有终端。** stdin 始终不是 TTY，需要确认才能清空依赖目录的包管理器会自己中止。
   - **运行前后各取一次指纹，变了就停。** 指纹是每个被链接目录自身、它的直接子项名单，以及其中包管理器状态文件
     （`.modules.yaml`、`.package-lock.json`、`.yarn-state.yml`、`.pnpm-workspace-state-v1.json`、`pyvenv.cfg`，存在才计）的大小与修改时间。
     任一次运行之后指纹不同，核验以 `DependenciesModified` 结束，不再运行剩下的步骤，也不发布任何结论。
     错误指出被改动的目录与变化的条目，并写明主 worktree 的依赖需要重新安装；它带着与其它进程错误相同的 `details.process`。

   `DependenciesModified` 表示保护已经失效、损坏已经发生，不属于 `FixUnverifiable`：后者说的是没法证明，前者说的是主 worktree 被改了。

   回归测试所在文件被某个 `testAdapters` 覆盖时，按 `test run --require-native` 的同一条原生选择路径运行，两端都必须是 green 或 red，任一端 invalid 时核验以 `FixUnverifiable` 结束；没有被覆盖时运行与 `test run` 相同的 runner 命令。全部命令在单槽测试任务与 OwnedProcess 下执行。
5. 缺陷提交上同一冻结命令以非零码结束，修复提交上以零结束。command runner 不区分断言失败与构建失败，red 只表示该命令的非零结果。零执行、全部跳过、取消、信号终止或清理未知的运行不计为 red 或 green。缺测试、缺提交（含 shallow clone）与超时是 `FixUnverifiable`。
6. 发布前重新核对 Issue 文件与回归测试文件的期望摘要，变化则拒绝。同一次发布删除 Issue 文件，并删除回归测试源码中指向它的 `@issue` 行；测试本身与其它标记保留。输出的结论包含缺陷与修复提交、按测试关联 ID 列出的回归测试、runner 配置摘要与执行它的 Concord 版本，供写进提交说明。

核验中任何一个由 Concord 启动的进程没有正常结束时，错误必须让人不重跑就能判断原因。这适用于 runner 命令、
adapter 的协议往返与它规划的原生调用。错误的 `details.process` 给出：发生在缺陷提交还是修复提交、是哪一步
（协议往返写明 op）、`argv`、相对仓库根的工作目录、退出码、信号、是否超时，以及 stdout 与 stderr 的有界尾部。
文本输出在 `message` 之后逐项列出同样的内容，`--json` 原样带上 `details`。尾部按既有诊断字节上限截断并写明截断；
环境变量的值不进入诊断。只说“进程没有以 0 退出”而不带这些内容，不是一条合格的错误。

`test verify --defect <D> --fix <F> <test-id>...` 在 D 与 F 上重放，核对结论的主张：回归测试在 D 上失败、在 F 上通过。之后的提交改动测试、runner 输入或 Spec 不使这个结论失效，之后的回归由完整测试发现。提交、依赖或运行环境不可获得时报告无法重放。

## 写入管线

文档与受管源码写入在工作区服务的写互斥下按以下顺序执行：

1. 校验规范化相对路径、拒绝受管路径上的 symlink 组件，并核对目标文件的期望摘要（CAS）。
2. 把全部计划变更写入绑定 root 与 privateDir 的单一 `journal.json`。
3. 以同目录临时文件和原子 `rename` 逐个发布文件。
4. 立即增量更新内存工作区图，删除 `journal.json`，并异步刷入持久缓存。

服务启动或运行恢复时自动处理未完成的 `journal.json`；若外部编辑器已修改目标文件，则保留磁盘当前文件并清理陈旧 `journal.json`，不锁死仓库。

命令助手与 Web 保存都走这条管线。Web 保存以整文件摘要作为期望摘要；源码保存只替换配置范围内既有的 JS/TS 文件。

人与 agent 的直接编辑不经过这条管线，由文件监听增量合入工作区图并由 `concord check` 检查（[操作依赖](#操作依赖)）。写入的可观察保证见[写入保护](use-case/recover-local-state.md#写入保护)。

## 步骤改写的发布

`use-case format` 沿用正文编辑的期望摘要与发布协议。

`rename-step`、`issue close` 与 `move` 均在单一 `journal.json` 与工作区服务的写互斥下一次性完成全部关联文件的原子替换：

- `rename-step` 绑定 Use Case 路径、old-id、new-id 与全部受影响文件的期望摘要。
- `issue close` 删除 Issue 文件，并从回归测试源码中删除指向它的 `@issue` 行，其余字节保持不变。
- `move` 完成文档移动，并同步改写受管 Markdown 链接、测试标记与代码声明中的目标路径；`unmanagedReferences` 只在规划时扫描并报告，不进入写集。

规划基于当前增量工作区图完成，提交阶段复核全部被改文件的当前摘要与期望摘要一致后原子替换（[写入保护](use-case/recover-local-state.md#写入保护)）。

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

仓库路径解析执行规范化相对路径校验与 symlink 检查（[写入保护](use-case/recover-local-state.md#写入保护)）：

- 拒绝绝对路径、`..` 穿越以及超出仓库根的路径。
- 对 Concord 受管路径（docs、memory、配置声明的源码与测试根、Concord 写入的配置与 skill 目录）检查 `lstat` 并拒绝 symlink 组件与非普通文件；Darwin 上核对目录条目的字节拼写，防止大小写与 Unicode 规范化碰撞。
- 目录扫描在受管路径之外遇到 symlink（例如使用者自己链接的 `CLAUDE.md` 或 `.claude/skills/<名称>`）时，不跟随、不读取，也不使检查失败；Concord 写入的 skill 目录内出现 symlink 仍报 `UnsafePath`。
- 文件读取按 `(mtime, size, inode)` 判断缓存命中；发生变化或写入提交前，读取最新字节并计算内容摘要，不再对每次读取执行从 `/` 到仓库根的逐级 `dev`/`ino` 巡检或 `/proc/self/fd` 反查。
- 写入提交前若目标文件摘要与读取时的期望摘要不一致，报 `FileChangedSinceRead`。

## TypeScript 编译器

解析、诊断与模块解析使用精确固定的 TypeScript 7.1 beta 原生编译器，构建与运行时同一版本，消费者无需全局编译器。

- 产品使用官方 `typescript/async`。`withTypeScript`、`withTypeScriptFiles` 与 `withTypeScriptSource` 返回 Promise，回调允许值或 Promise。`withTypeScript` 用 AsyncLocalStorage 隔离调用链并惰性取得 API；同链嵌套复用，独立并发调用互不借用。`withTypeScriptFiles` 总是独立捕获作用域。关闭后访问 API 报 `TypeScriptScopeViolation`，包括已提取的方法；所有子调用必须等待 settle 后才关闭作用域。API、AST、snapshot 与 program 不逃逸，缓存仅保存投影后的领域值。纯 AST 操作仍从 `typescript/ast` 同步执行。
- API 固定 `runExternalCode: false`，使用包内可执行文件，不接受项目路径覆盖。默认文件系统回调拒绝读写，允许的文件只来自完整的请求虚拟文件系统，不回落到宿主。项目配置与 MDX content mapper 不获得执行权限。
- `withTypeScriptSource` 等待只含当前文件的虚拟快照、SourceFile 与真实语法诊断；领域投影结束后逆序 await snapshot、解析句柄和 API 的释放。官方 close 只证明会话关闭，进程退出由进程 owner 另行确认。已有领域主失败保留其错误码，释放失败写入同一错误的 cleanup 诊断；无主失败而清理失败为 TypeScriptUnavailable，不能报告成功。任何单项释放失败都不能阻止其余释放尝试。
- `withTypeScriptFiles` 只提供已捕获文件与派生目录，在捕获集合内解析 tsconfig（含 extends）并解析模块。失败保留既有缺口，不读取宿主 tsconfig 或 node_modules。
- p5 在建立快照前递归捕获静态 import/export、import type、ImportTypeNode 与三斜线相对类型路径，经既有预算与路径校验后固定闭包，解析期间不修改虚拟文件系统。p5 lib 与声明来自固定编译器包与发行包。
- 配置解析、代码/测试声明分析、依赖分析与 p5 调用链显式 await 编译结果。Effect 边界等待拥有资源的 Promise 完成再释放外层 scope，不允许 Effect 产出未完成的 Promise receipt。
- 内容缓存的异步方法只在 miss 时等待 parser，保持输入顺序和逐文件失败语义；命中不启动编译器，失败不缓存。跨 await 只保留领域值与待写行，写入时重新取得有效 cache handle，不保留可能被 owner 淘汰的 native handle。
- `PersistentCache.withView` 及 analysis reader 的借用绑定持续到异步回调 settle；成功、失败和取消均先完成 callback 收尾，再解绑 cache/来源。
- `LocalRepository.open` 是异步工厂；返回前验证配置并归还初始化 FD 与缓存资源，成功返回不代表已有活动 snapshot。写工厂仍要求 publication validation 能力，不公开未初始化对象。
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

**输入身份**：项目、root、worktree 与 server/profile 构成一个分析单元，`inputs` 按当前增量工作区图的源码、测试与配置摘要计算。

**生命周期**：

1. 外部进程在工作区服务的单槽任务与 Effect Scope 内运行，不需要因此关闭工作区服务的持久缓存句柄。
2. 取消时先发协议取消，再平衡关闭文档、`shutdown`、`exit`；超时后 TERM 再 KILL，并核对进程组与输出管道终结。
3. 清理成功后，若运行期间未发生源码写入失效，直接将观察更新到内存工作区图与持久缓存。

**信任**：server 是受信程序，进程组管理不是文件或网络沙箱。client 不发 `workspace/executeCommand`，对 `workspace/applyEdit` 回 `applied: false`，其它请求按方法白名单严格解码。配置响应只含显式公开项；凭据与原始环境不进入缓存或诊断。

## 编辑器计算

`concord lsp` 为每个会话维护 URI 到文本、languageId、版本与打开标识的内存 overlay，并通过本机 RPC 将未保存的 overlay 与查询请求转发给工作区服务单内核计算（无服务模式在本进程内复用同一计算逻辑）。未打开的依赖直接复用工作区服务内存中已热的增量工作区图，不再为每次编辑器计算单独派生新的 Bun 进程组。

每次任务捕获会话标识、依赖的 URI 版本与当前工作区图状态，返回前若缓冲区版本已更新则直接丢弃过期结果。步骤、标记、引用解析与写作检查使用同一版本集合。

单个计算任务超时或失败只取消该次任务并返回诊断，不会将整个会话永久锁死在 `EditorTaskFailed`，后续编辑照常触发新计算。编辑器计算任务只读，不修改磁盘文件。

## 原生 adapter

项目测试运行时与 Concord 内部角色分开。内置 Node test 和 Vitest 的版本查询与项目执行从项目环境的 PATH 选择 `node`；Vitest 收集角色由 Concord 自身启动，并从显式项目根加载框架。编译后的 `process.execPath` 不能用于解释任意项目 JavaScript。

**绑定**：先按 provider 的 group key（项目、文件、声明范围与组身份）归并参数项，不凭同名合并。

- 标记块从首个关联标记到连续元数据末行。
- 自动绑定优先最内层包含标记的唯一 leaf 组，否则取紧随其后的唯一 leaf 组；中间只允许空白及 provider 明确覆盖的注释或装饰器。
- 有普通语句、同深度重叠、缺范围或只有 suite 时不自动绑定。
- `@native` 与可验证的自动绑定不一致时报 `NativeSelectorConflict`，歧义报 `AmbiguousNativeBinding`；二者都是执行前失败，不是 check finding。
- 执行集按 native ID 去重，一次结果可投射到多个关联。

**输入身份与协调**：`inputs` 绑定当前工作区图的测试文件、源码与 adapter 配置摘要，无需手工枚举传递实现文件或构建锁文件。adapter 进程在工作区服务的单槽测试任务下运行，不需要关闭持久缓存句柄；运行期间若源码或测试发生修改，则标记本次观察非当前（`current: false`）。

**报告**：每个 run 分配新报告目录，每个 Invocation 独占一个执行前为空的子目录。拒绝 symlink 与目录逃逸；XML 禁止 DTD 与外部实体。目录在最后一个使用者结束后清理。

## 文档身份

名称语法、分类根、package 与 leaf 布局及短选择器由同一政策模块定义，严格解析共用 codec。类别由路径决定；名称取正文唯一的一级标题，按 Markdown 语法树识别，代码块中的标题不计。大小写与 Unicode 规范化碰撞按[路径安全](#路径安全)保护。

CLI、Web 与页面编辑把选择器解析到实际路径后，在工作区服务的写互斥下核对目标路径与期望摘要，变化即拒绝。

## 生命周期

### 从接入到 Spec

初始化只在 Git worktree 顶层执行，子目录项目与 bare repo 明确拒绝；冲突即失败，以保护已有文件。Feature 与 Use Case 建立当前 Spec。

Roadmap 采用把目录原子移入 `docs/feature/`，规则见[采用 Roadmap](use-case/plan-and-adopt-contracts.md)。

- 在单一 `journal.json` 中写入新路径、改写指向原路径的链接与关系，并删除原目录。
- 集合内的相对链接改写，集合外链接保持原目标。
- 目标冲突与采用期间的来源变化在提交前拒绝。
- 当前语义转由新 Feature 拥有，采用历史在 Git。

### Issue

Issue 只表示还要处理的问题；`issue close` 执行需要的步骤后删除文件，fixed 先经过[修复核验](#修复核验)。`spec` 关系只列这个 Issue 当前涉及的 Spec。

### Memory

Memory 没有生命周期状态，过时就改写或删除，历史在 Git。

### 退役与恢复

测试关系用 `@status retired` 明示退役。缓存可随时 clear/rebuild。未完成写入由服务启动或 `recover` 根据 `journal.json` 自动恢复；遇到外部编辑冲突时保留磁盘当前文件并清理陈旧 journal。

## 独立与本地

核心流程不需要账号、模型 API 或云服务。

- Concord 作为独立安装的程序工作，只需要本地 Git 仓库，不依赖其它仓库的 worktree、全局安装、provider 凭据或部署服务。
- 可选外部接入必须有明确边界，不成为基础本地流程的前提。
- 本地 Issue 不依赖外部服务。远端写入需单独授权，本地操作不自动投射为远端变更。
- Concord 不自动发版、push、调用付费模型或操作远端 Issue。

## 信任边界

仓库作者负责 runner 命令声明。工具不自动触碰生产、远端或凭据。

## 操作依赖

Repository 负责安全读取、配置身份、依赖观察和发布，文档模块决定哪些路径参与当前操作。全局诊断与局部查询共用严格 decoder：局部查询按命令依赖取 owner，全局诊断逐文件保留错误并传播 `complete: false`。

| 操作 | 内容依赖 | 协调 | 失败范围 |
| --- | --- | --- | --- |
| list memory、list issue、memory search、issue search | 相应来源内全部候选 owner | 来源快照 | 范围内坏记录、来源缺失、配置或事务障碍 |
| show 的 canonical path | 指定 owner | 来源快照 | 目标或其必要依赖 |
| show 的短选择器 | 相应类别的全部候选及唯一匹配 owner | 来源快照 | 集合不完整或歧义 |
| new | 目标路径与同类短选择器集合 | 写互斥 | 身份冲突、必要依赖或写入资源障碍 |
| memory link；issue link、unlink、close | 指定 owner、当前摘要与关系目标 | 写互斥 | 目标或关系目标缺陷、写入资源障碍 |
| code/test marker | 每个指定 canonical reference、归属链、类型、anchor；显式 `@issue` 目标 | 来源快照 | 指定依赖缺陷，不加载全局 Trace |
| trace、review | 展示的关系图 | 来源快照 | 输出 findings；需要完整图的结论拒绝不完整输入 |
| check | 全仓库事实与关联 | 来源快照 | 各 owner 解析错误累计为 findings，`ok: false` |
| issue close、roadmap start | 核验与保证关系完整所需的集合 | 写互斥；fixed 另占测试任务槽位 | 保留严格身份、修复核验和逆向关系要求 |

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

局部解析读取工作区服务的当前工作区图，不进入写互斥。服务在应答请求前已完成 journal 恢复，读取不会遇到未完成的写入。

读写 access 与 dryRun 的分离、写互斥和恢复结果见[可移植协调架构](../portable-coordination/architecture.md)。跨功能规则见[操作依赖与发布协调](../../architecture.md#操作依赖与发布协调)。

## 私有状态

Git-private 目录由 `git rev-parse --git-path concord` 定位，其中的服务锁、HawDB 缓存、journal 与修复核验的临时 worktree 属于当前 worktree。普通单 worktree 仓库通常落在 `.git/concord`，linked worktree 则使用自己的 Git-private 路径。

缓存可清除重建；journal 只用于安全恢复，不取代 Markdown 或测试源码。私有目录中的其它文件不被读取，也不被删除。

## 解码与路径边界

所有不可信 JSON、YAML 和缓存内容必须严格解码。路径拒绝绝对路径、traversal 与 symlink 逃逸，读取检查的实现见[路径安全](#路径安全)。修复核验只证明 runner 在两个提交上的退出结果，不继承任何产品专属 E2E 可靠性声明。


编译器会话由固定的 TypeScript supervisor 持有，官方 `tsserverPath` 只指向此入口；安装模式在同一可执行文件识别严格的 `--api --async` 参数，源码模式按源码、锁、Bun 与目标身份惰性编译外部缓存中的最小入口。源码准备有 120 秒期限。supervisor 只启动包内固定 native executable，关闭 external mapper，标准流透明转发并使用背压，不累积或截断 RPC。

supervisor 和 native 均继承调用者的进程组，不再建立可逃逸的 native 组；只用专属新 pipes 连接 native 的 stdin/stdout，不继承 supervisor 的协议 fd 或 IPC。会话总期限 600 秒，父 stdin EOF、TERM/INT 或期限触发幂等停止：停止 relay、关闭 native stdin、TERM、500ms 后必要时 KILL，再等待自有 child close。不对继承组发信号。异常收尾中止背压等待，不伪造响应；外层进程组回收仍验证整体退出。

TypeScript 使用依赖清单与锁文件记录的 Bun 安装补丁：官方 JSON-RPC connection 关闭时 dispose connection，保证初始化和在途请求拒绝；不复制 RPC、不读取私有 client 字段、不在运行时改写依赖。补丁字节参与依赖与构建身份，所有来源和归档使用同一补丁。
