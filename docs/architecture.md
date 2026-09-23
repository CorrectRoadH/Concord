# Concord 架构与行为契约

## 初始化与项目治理的采用设计

2026-09-14 采用 [TS-only 运行时方案](design/ts-only-runtime/plans/ts-only/README.md)，替代初始化设计中的旧格式兼容规则。独立 Astra 挑战最终 PASS，实际交付由完整 pnpm check 与打包消费者验证。渐进初始化、多来源 Memory 和宪法治理继续有效；未涉及的证据等级、路径安全和 owner 分工保持原契约。

新项目生成静态 concord.config.ts，旧 concord.json 返回 ProjectMigrationRequired，双配置同样拒绝，不执行 TS 模块。配置快照统一拥有原文前像、路径与摘要，写入/恢复/证据使用一致协议。Memory 首版仅 worktree 内本地文件来源，canonical path 拥有身份，只读权限在 publication 统一执行。

docs/constitution.md 必需，默认可明确为 draft；作者显式采用 active。Feature/Design 通过 constitutionRefs 声明条款，反向影响派生，宪法不得冒充测试契约或自动合规证据。根 DESIGN.md 可选；页面默认值可按次覆盖。详细状态格式、引用解析、恢复及组合验收均以上述方案页面为准。

源码注释与 Markdown 拥有协作事实，HawDB 只保存可重建缓存。

## 领域与 CLI

`concord --root <repo>` 指定消费者，默认从 cwd 向上发现 `concord.config.ts`；发现旧 `concord.json` 时仅返回具名迁移错误；`init` 只初始化显式目录或 cwd。安装目录绝不充当消费者根。

- `--skill [topic]`：在任意 cwd 读取随包 Agent 指引，不加载 host、不写文件。默认短路由，按 init/document/test/memory/trace/recovery/repository 读取，all 展开全部。未知 topic 或混用写命令具名拒绝。
- `init`：一次建立本地 Git 仓库中的静态 concord.config.ts、必需的 docs/constitution.md、完整分类目录、docs/concord.md 指南、缺失的 docs/README.md 和 docs/_template 全套模板；根 DESIGN.md 可选。已有文件保留或具名报冲突；根入口、concepts 与 architecture 骨架仅在缺失时创建。`--test-root` 可重复，`--runner-config` 接受严格 runner JSON；默认配置仍是 Node 原生测试。纯文档仓库使用 `--docs-only` 保存空 testRoots，不要求测试目录；以后添加真实测试根即可启用发现。该选项与 `--test-root` 互斥。
- `feature create/list/show`、`use-case create/list/show`：当前目标及其叶子用户路径。
- owner `show` 面向 agent 返回路径、metadata、digest 与当前派生关系，不重复输出可直接读取的 Markdown 正文；Feature 汇总直属 Use Case 及其测试/实现声明。`page show` 与模板查看仍返回其明确请求的正文。声明关系不代表执行或覆盖率。
- `research create/list/show`：研究输入，保留安全嵌套路径；观察日期仅在原文明确时记录。
- `engineering create/list/show`：仓库测试与维护机制的目标、使用与验收。
- `template list/show`：在任意 cwd 查看随包写作模板，无需初始化项目。
- `doctor`：检查项目配置、缺失测试目录和当前关联，给出接入步骤，不执行 runner。
- `design create/check/format/decide/list/show`：候选比较、逐项检查、有限格式化、唯一裁决及关联目标。
- `roadmap create/adopt/list/show`：已定稿方向与显式采用。采用创建 Feature，Roadmap 标记 adopted 并保留历史；当前契约只在 Feature。
- `test list/show/run`：从测试声明旁的源码注释派生测试执行引用并发现目标契约与 regression Memory；项目级配置拥有 argv、附加 sourceFiles 和 timeout。源码正常编辑与 Git 保存测试演进，Concord 不再建立测试关系 sidecar。
- `test annotate`：验证 Feature / Use Case 目标与 Problem 引用后输出注释片段。它不改测试源文件，也不自动运行测试。
- `cache status/rebuild/clear`：维护可删除重建的 HawDB 解析缓存。
- `memory add/list/show/search/activate/resolve/reopen/supersede/promote/retire`：Problem、Decision、Insight、Note 及历史；captured 表示尚未确认当前生命周期。
- `author set`：用完整 owner preimage digest 更换契约或 Memory 正文，保留工具拥有的 metadata 与历史。
- `issue draft/list/show/link/close`：本地 Observation 与 Memory 链接；`feedback` 统一提供本地反馈和 GitHub / Linear 读取接入，来源快照与本地状态分离，不执行远端发布。详见 [Feedback 契约](feature/feedback/architecture.md)。
- `trace show/check`：从各 owner 编译图，检查目标存在、类型、重复及循环，动态反查测试和 Memory。不输出虚构覆盖率。
- `review render`：从契约、当前测试、证据和 Memory 生成本地 Markdown 审阅材料，不自动写 GitHub。
- `check` 与 `recover`：完整性和中断写入恢复。

## 存储契约

消费仓库中使用 Markdown 加严格 YAML frontmatter。Feature、Use Case、Design、Roadmap、Engineering、Research、Memory 分别有 schema 与具名操作，不公开通用 CRUD。

文档创建省略 `--body` 时使用随包模板；显式文件/stdin 正文仍可用。模板是作者提示，不是完成状态或验收证据。Feature、Roadmap 和 Design 候选使用相同体裁，README 必需。可选的 library、cli、architecture、lifecycle 和 use-case 索引通过可重复或逗号分隔的 --pages 选择，省略时采用项目默认页面，显式 --no-pages 或结构化 pages: [] 仅生成 README。未知、重复选择和不支持的种类明确拒绝。Engineering 默认 README 定义目标、机制、使用与验收，按主题使用 page add 扩展。Design 外层包含 GOALS、LIMITS、DECISION 和 CASES，候选放在 `plans/<alternative>/`；候选身份仍由主 owner 的 alternatives 声明，普通页面不新增 metadata 真源。旧 Design 缺少模板页仍然有效，DECISION 正文不会改变 metadata.decision 中的裁决。

`feature/roadmap/design/engineering page add/show/set` 维护已存在 package 的页面；也支持安全小写 slug 的自定义专题页，路径固定为 package 内的 `<slug>.md`，继续使用整文件 CAS。Design 外层保留 goals/limits/decision/cases 的既有路径，候选模板页须指定 plan。Design 候选通过 `--plan` 选择。set 必须提供最新整文件 digest，主 README 正文写入保留 metadata。普通 supporting Markdown 继续进入 candidate 摘要，不因为由模板生成而变成独立 owner 或测试证据。测试 contract 仍限于 Feature / Use Case；Engineering owner 可作为 Design 裁决和 Memory promotion 的目标。

模板安装在工具包内，由严格 manifest 校验名称、路径、库存和普通文件类型，不依赖消费仓库或 NiceEval checkout。init 一次生成完整分类目录、docs/concord.md、docs/_template/ 全套可读参考模板，以及缺失的 docs/README.md、docs/concepts.md、空 docs/concepts.json 和 docs/architecture.md。已有上述根文档保留。根 AGENTS.md 由 init 保留既有正文并追加或刷新一个带明确边界的 Concord 托管区块，指向当前安装版本的 `concord --skill` 路由；缺失时创建。标记残缺时拒绝写入，不猜测或覆盖用户内容。参考模板不成为契约 owner，create 使用随包模板，不把参考文件解释为自定义配置。

路径是文档 canonical identity。测试关联是测试根里的 Concord 标记：`//`、`#` 或 `--` 开头的 `@feature <path>` 或 `@use-case <path>`，并可使用 `@regression`、`@status retired` 和可选 `@name`。标记存在即表示测试存在。身份由文件和标记派生 `neref_...`：有 `@name` 时用该名称，否则用契约路径加同文件序号。无需人工 ID、分配或 attach 步骤。反向列表由当前源码派生，不写回契约，也不保存 JSON 测试关系副本。

扫描不解析宿主测试声明。JS/TS 只用 TypeScript 注释范围排除字符串、模板和正则中的伪标记；其它文本文件按注释前缀认标记。缺值、一块标记上的重复契约、以及只有 `@regression`/`@status`/`@name` 的块产生 finding。不认识的测试写法不是 finding。静态索引不是 native runner inventory。项目配置保存 testRoots、runner argv、附加 sourceFiles、timeout。argv 的 {file}/{name}/{pattern} 占位符仅按参数替换，不经过 shell。没有 `@name` 时 `{pattern}` 为 `.*`，默认 Node runner 运行整个标记文件。运行收据明确 scope: command 和 selectedCaseId；不渲染为 native case passed，零测试或 skip 不能因此被称作 case 已通过。

HawDB 位于 Git-private `cache.hawdb`，只拥有可重建缓存。每次查询核对路径集合、内容摘要与解析器/schema版本，cache 命中仍需严格解码；缓存损坏、schema不符或写入失败回退到源文件编译，不返回陈旧结果。只缓存解析结果和投影，不缓存可绕过核验的授权或 Problem fixed 判定。clear 不删除 evidence、journal 或 Memory。一次 SQL transaction 更新同一代投影，源文件不是 SQL transaction 的一部分，必须通过前后摘要检测读取漂移。

HawDB 的[引擎边界与预算](design/hawdb-data-engine/plans/native-embedded/README.md)区分短快照持久句柄和进程期内存句柄。配置、feedback 观察与 status 只读打开现有完整库，缺少 ownership 文件或命名空间不补建；所有持久句柄与事务先于 repository lease 释放。文档解析、代码解析及不可变 Git 测试基线同样使用有界 HawDB 内存命名空间，不另存解析结果 Map。当前源文件集合和字节仍每次读取。

cache clear 在独占 repository lease 下取得与固定 HawDB revision 相同的原生文件锁，持有锁清理数据，保留目录与锁 inode，owner-only 目录显示 empty。锁错误不授权删除；损坏库通过独立锁 guard 清理，不靠打开数据库成功。旧 cache.sqlite 与列明的 sidecar 只在显式 clear 时处理，不读取或自动迁移。clear 不删除源 owner、证据和发布日志。路径类型、安全、预算、冷/热查询及跨进程恢复均须独立验收。

Memory 保存 current promotion 和追加的生命周期 history，Problem 使用递增 epoch；reopen 增加 epoch，red/green 都必须绑定当前 epoch。

init 必须作用于 Git worktree 顶层；子目录项目与 bare repo 明确拒绝。

`concord.config.ts` 是新项目的 concord.project/v1 项目标记，旧 `concord.json` 须先显式离线迁移且双配置拒绝；采用固定的 docs/feature、docs/roadmap、docs/design、docs/engineering、docs/research 约定及配置声明的 Memory 来源。已有这些目录可以共存，但 init 遇到要创建的文件冲突时零写入失败，不导入或修改未知文件。

Roadmap adoption 递归包含实际 Markdown 页面并保留目录结构；旧 Roadmap 保存 adopted 历史，新 Feature 拥有当前契约。内部链接指向新副本，集合外相对链接保持原 canonical 目标；不能安全处理的链接、非 Markdown 附件、嵌套 owner、symlink 与目标冲突具名拒绝，不静默丢弃。规划再次检查源集合与摘要，并将 supporting source 的同内容 guard 纳入 publication；guard 会按现有协议原子重写并列入 changedPaths，不是只读断言。观察到的来源变化阻止发布；不额外宣称对不合作编辑器的线性化保证。

Trace 与定向 Review 按解析得到的 owner 汇总 Feature supporting page 与 Use Case 的测试关系，保留 exact path/anchor，不用目录前缀混入相邻 Feature。默认输出供人阅读，`--json` 保留结构化结果的含义。

读写路径拒绝绝对路径、traversal、symlink 组件和超出 repo 的 realpath。扫描只读取 Concord 所属目录和格式；错误的受管格式明确报错。

Git-private 状态通过 `git rev-parse --git-path concord` 定位，每个 worktree 独立；journal 绑定 projectId、root 与 privateDir。0.6.0 采用[可移植发布协调](design/portable-publication/README.md)：文档发布协调仅用 Node 文件 API，移除外部 flock、stat、diskutil、plutil 和卷名称准入探测。支持同主机、同 PID 命名空间内的 Linux/macOS 本地工作树；网络多机协调与 Windows 执行不在保证内。macOS 保留大小写、Unicode 路径碰撞和 symlink 防护。

一个非空 publication.lease 目录拥有短快照与提交互斥；完整 token owner 经临时目录 fsync/rename 原子公布。构造 LocalRepository 不持有命令全程锁；显式 snapshot 读取完整规划输入，提交在同一短 lease 下复核首次读取、缺失文件、目录集合与类型、配置和完整前像，再写 preimage journal、逐文件原子 rename。正常释放与显式死 PID 恢复只删除准确 token；不按年龄抢占，不递归删除活动锁目录。HawDB 只保存可删除重建的缓存，其持久连接和清理也在快照内。旧锁协议不迁移、不支持混合版本同时运行。

`concord recover` 路由当前唯一的普通或 Trace journal；多 journal 现场冲突时保留并拒绝。各恢复入口获锁后重查类型和现场，只在内容符合 preimage 或 planned digest 时恢复。dry-run 执行同一规划校验，不发布 owner、journal 或缓存；已有项目的短协调可能创建 Git-private 目录。

CLI/Web 测试共用独立 runner.lease，长执行不占文档 lease。持久 run 状态区分 running、finalizing、quarantined，只有同主机活进程的 running 状态允许发布，并且发布前必须持久标记该次 run 已失效；A→B→A 和回滚不撤销失效标记。结束在新快照中核对起止 candidate、配置、定义、契约、epoch、失效与清理结果，再写证据。父进程死亡不能授权回收 runner，清理未知时保留阻断；若最终快照无法取得，则留下只会收紧权限的 token-bound quarantine 标记。此协议不宣称能够观察不合作编辑器的每次瞬时修改。

## Design 逐项比较与裁决

详细行为见[逐项比较方案并明确裁决](feature/local-sdlc/use-case/compare-design-plans.md)：GOALS/LIMITS 每条为稳定 G/L 编号的 H2；所有候选以四列表格逐项回应。DECISION 显式选择的 slug/link 须与请求及 metadata 一致，所选候选全部 Limit 满足，Goal 缺口逐项解释。显式 `design check` 检查当前正文，普通读取及全局 check 不追溯新的写作门槛；正文后续变化不重写历史裁决。`design format` 仅整理识别出的 H2 与四列表格空白，保留编号、锚点、链接和代码块，不能补充选择或证据。

2026-09-20 独立 Herdr design_grill（GPT-6 Astra，concord-design-astra-0920b）完成问题与回答后给出 PASS。新定案绑定 owner、GOALS、LIMITS、DECISION 和所有候选 README 的同一次读取；主 publication 的同内容 guards 实际重写并计入 changedPaths，沿用 journal 恢复。repository 入口保留自己的 lease/preimages，并在 dry-run 返回前也复核完整输入；候选投影按 metadata.alternatives 顺序派生，不再扫描旧 PLAN-N。此设计结论不替代实现验收，也不证明自然语言声称的满足度。

## 测试执行和证据边界

项目配置中的运行命令是一个用户声明的验收单元，工具记录这一命令的结果，不声称收集或证明底层 runner 的每个子 case。它不是 NiceEval 的 formal E2E inventory、可靠性证书，也不证明完整覆盖。

run 在当前消费者 cwd 下执行项目配置中的 argv，shell=false；设置 timeout，取消或超时清理进程组，不能把信号或启动失败记为通过。仅 run 会执行仓库命令；help/list/show/check/render 均不执行。命令由本地项目作者信任与维护；本轮验证只执行我们创建的隔离消费仓库，无付费 provider、远端 mutation 或生产副作用。

证据由 Concord 自己运行产生，在 Git-private 下以不透明 ID 保存。收据包含 schema/version、scope: command、selectedCaseId、definition digest（含标注、完整测试文件、项目runner配置与声明 sourceFiles 的字节）、contract digest、argv/cwd、候选摘要（所有 Git tracked 与 nonignored untracked 文件，仅排除精确识别的 Concord owner 文件，不排除目录；owner 不能作为测试 sourceFiles）、开始/结束、exitCode、timeout/cancel/cleanup 结果、stdout/stderr digest。内部证据完整性摘要用于检测意外损坏，不宣称抵抗有本地写权限的恶意用户。

`memory resolve --kind fixed --red <id> --green <id>` 要求当前 active 标注的 regression 指向该 Problem、同一测试定义和目标契约、red 为普通非零退出（非超时/信号/启动失败）、green 成功且清理成功，red 先于 green，green 候选摘要匹配当前消费者内容。sourceFiles 是作者声明的测试、启动脚本与断言配置；工具只校验这些字节不变，不证明依赖闭包、断言完整性或根因。fixed 要求作者用非空 --reason 明确裁决修复，resolution 持久化 evidenceLevel: command，show、check、review 与 JSON 一致显示。产品文件可变化。red 与 green 都由 CLI 签发，不能导入手写 JSON。run 前后必须校验 candidate、definition 与 contract 摘要相同；运行期间发生变化的证据不能用于关闭。摘要不证明 ignored dependencies、外部服务或完整执行环境。重复运行不是初版 fixed gate；这种证据等级明确标为 command，而不叫 formal E2E。新 clone 缺少私有证据时，历史 resolution 仍可读，但 check/review 必须显示 unavailable，不能当作当前验证。

Memory 其他关闭理由需要非空说明；reopen 追加历史并移除 current resolution；supersede 只允许相同 kind 且不得形成循环；promotion 只能指向有效当前契约，不复制正文。

## 验收

独立安装无 workspace:*、NiceEval 路径或运行时 import。构建为带 shebang 的 Node CLI，pack 到 tarball，在仓库外临时消费者安装后使用其 bin。

真实闭环：init → feature → use-case → problem → 给真实 Node 测试添加契约/回归注释并配置 runner → 缺陷 red → 修生产 fixture → green → resolve → trace 与 review。另覆盖错误引用、无证据关闭、伪造/陈旧证据、测试源码变化、重开、退役、缓存删除/损坏/旧版本、注释修改/重命名/删除后的缓存失效、动态/悬空/重复标注、跨 cwd/root、路径穿越、写冲突、并发写、journal recovery、超时清理和独立安装。

实现、测试和构建脚本维护为严格 TypeScript，执行与副作用通过 Effect 组织。构建脚本使用 Effect FileSystem 和 ChildProcessSpawner；测试通过 Node test adapter 执行 Effect，用 tsx 加载 TS，并纳入 typecheck。dist 中的 JavaScript 是编译产物，JS 消费者的兼容 fixture 只存在于明确的测试边界。

仅 native/hawdb 的 Rust 引擎桥接、必要链接胶水、字节转换、预算和固定 revision 所有权 guard 适用 c-005 的原生例外。发行 tgz 同时携带 Linux x64/glibc 与 macOS arm64 产物，绑定源码、ABI、revision 和摘要；消费者不需要 Rust 或数据库服务。平台构建完成后统一打包，目标平台安装同一份包验收；本机 Nix 构建不视作通用发行物。

`pnpm check` 构建后检查测试与脚本类型，再执行领域、恢复和 package smoke；公开 CLI 验收使用独立安装后的命令。保留来源说明、README、Agent 工作流指引与 CI 检查配置，不发布或 push。


## 注释方案的约束裁决

注释 current 身份只保证当前扫描集合唯一。撤销旧 JSON 方案中“ID 永不复用”和由工具保存测试 update 历史的承诺：测试演进由 Git 保存，工具不提供跨删库、删源码、删历史的永久身份登记服务。证据绑定完整测试文件、路径、声明、runner 配置、契约和 Problem epoch，不能单凭同名 ID 重用。测试文件即使拥有注释，也完整进入 candidate/definition 摘要；不能套用 Markdown owner 的排除规则。

开发者可正常编辑注释并以 Git 审阅，也可通过共享 `source.set` 操作替换配置范围内既有 JS/TS 文件；该操作使用完整文件摘要保护和受限恢复日志。scan/check 不改写源文件或补写历史。文档与 Memory 的具名写命令使用同一当前 journal 格式；其唯一提交点是全部 planned 文件发布并持久化 committed journal。缓存在源事实提交以后刷新；cache 失败不回滚源文件。

测试标记不核对 runner import，也不把函数名 `test` 当成测试声明。`@status retired` 的标记不能生成 fixed 证据。命令结果显示 observed execution 为 unknown，或由明确支持的默认 Node TAP 计数观察为 nonzero/zero/skipped。已知零执行或全跳过的收据不能用于 fixed。通用命令的 unknown 不被显示成原生 case passed。

缓存身份包含 projectId、root/privateDir（worktree）、testRoots/runner配置、完整路径集合、每文件字节摘要和解析器版本。无论冷热缓存，关系验证都使用当前 Markdown。fixed gate 从权威源码重新构建并核对，不信任 cache 的状态判断。

## 代码归属声明

Code Declaration 是维护者对实现与契约关系的显式声明，源文件是唯一 owner。独立 `code:<id> → exactRef` 的 `implements` 边不会成为测试声明、覆盖率、完成状态或 Problem fixed 证据。2026-09-13 的独立 Astra 挑战确定范围与绑定规则；2026-09-20 的独立 Herdr Astra 挑战 PASS 后采用[自动查询引用](design/derived-code-reference/README.md)，替代手写声明 ID。

`sourceRoots` 为严格配置中的可选路径数组，缺省 `[]`，构造和 init 沿用既有安全路径验证。仅扫描显式根内 JS/TS；允许与 testRoots 重叠，各 family 保留自己的标签语义。代码声明解析按文件缓存在同一份可清空的 HawDB 中，键包含 worktree、解析器版本、路径和当前字节摘要；命中仍严格解码，摘要不符、损坏或写失败就回源，不返回旧声明。归属结论、关系边、缺口和 fixed 判断不缓存，关系始终用当前 Markdown 重算。扫描仍核对前后文件集合及摘要。未改动的配置解析也可命中同一库，使后续命令不必加载 TypeScript 编译器；配置源码仍是唯一 owner。HawDB 测试缓存与独立 evidence 协议保持各自职责。

三种 scope：文件头 `@concord-file`，紧邻支持的完整 AST 节点的 `@concord-code`，同一 statement-list 内非空连续语句的 `@concord-begin/end`。范围标记均无参数，一个文件级 scope 或节点最多一份声明，多目标通过相邻 implements 表达。node 白名单为有 body 的函数声明/方法、类声明，以及单 identifier 且直接 arrow/function initializer 的变量语句。region 不嵌套、不截断表达式、不跨语句列表，但可以包含完整函数。所有 scope 可在允许的范围内完整包含，查询返回全部包含关系，不推断覆盖或继承。

绑定和孤立标记诊断都消费真实 TS comment ranges，不能从裸文本行认领字符串、模板、正则或 JSX 伪标记。有真实代码标记且存在语法错误的文件不产生有效代码声明。起始块内 implements 必须连续相邻；具体语法与位置规则由 [使用指引](../skills/concord/references/code.md) 说明。

目标支持 Feature、Use Case 与 Engineering，沿用 owner/supporting-page/anchor 解析，仅拒绝重复 exactRef，不合并不同 anchor。Feature 反查汇总自身与 Use Case；Engineering 汇总自身与支持页面，不拥有 Use Case 子树。反查按自动引用去重，保留匹配 exactRefs。

`id` 由版本、canonical 源路径、scope 与完整 AST 结构位置派生，不含行号、函数体或关联目标。命名节点的定位路径与同描述前序兄弟不变时，普通编辑保持引用；文件移动、改名、作用域和顺序变化可能使旧引用失效或复用。引用不是永久身份、CAS 或授权，调用方须重新 list/locate 并核对位置。固定元组、名称和序号规则见[采用架构](design/derived-code-reference/plans/derived/architecture.md)。

`code annotate` 与对应 action 不接收或返回 ID；`code list` 和 `code locate` 提供声明查询。按 ID 查询的命令已删除，不提供兼容入口或迁移协议。Web 以符号、位置和显式关联呈现实现。范围标记不接受参数，无效 begin 仍参与边界检查；普通扫描不写源码。

代码错误阻断 code/check/trace/review/doctor；test list/show/run 与 memory resolve 显式不包含代码投影，仍保留全部原有文档、测试关系和证据校验。evidence 不接收 code ID，完整源码及候选摘要不会因为新注释被剥离。公开打包入口验证三种 scope、反查与位置查询、源码变更、非法边界和此隔离行为。

## 中立高级治理

2026-09-20 采用 [中立治理方案](design/neutral-project-governance/plans/generalize-profile/architecture.md)，独立 Herdr Astra 设计挑战 PASS。该裁决替代先前 repository profile 的产品专属配置、host、锁位置和执行协议假设；实现验收不由设计 PASS 代替。

`concord repo` 保留为中立高级治理入口。Concord 拥有声明身份、契约关系、Memory 生命周期、证据要求和权威 validator；消费者拥有 runner、原生副本与清理，以及产品构建/Preview/Examples/部署/PR 组合。显式 suite roots 不依赖 Nx 或 e2e 布局；静态 trace 与 Web 不加载 host，不要求 lanes/executor。

版本化的可靠原生要求与 command 证据严格分离。Problem 已采用的下限持久化并在所有 fixed 入口执行；新证据绑定配置、policy、adapter 实现、当前测试/契约和 epoch。red 允许绑定实际缺陷候选，green 与可靠性观察必须绑定同一修复候选。旧证明保留历史，不补字段或重新签发。

Research、Memory、Issue 继续共用唯一 `concord.document/v1` 模型。新协调路径为 Git-private `concord/trace`，旧现场通过停写、旧新持锁和完整前像计划显式离线迁移。细节见[高级测试治理](repository-profile.md)和[设计中的迁移及验收要求](design/neutral-project-governance/plans/generalize-profile/architecture.md)。

## 人用 Web 与 AI CLI

`concord view` 提供随安装包分发的 React 工作台，默认监听 `0.0.0.0:4317`。Feature、Engineering、Roadmap、Design、Research 是独立入口，Use Case 保持在所属 Feature 内。WYSIWYG、基础交互与 Git diff 展示采用 MDXEditor、shadcn/ui、react-diff-view，不另写 Markdown 或 diff 引擎。

Web API 和 CLI 结构化 action 共用完整应用校验，fixed 的 red/green 验证不会因入口不同而省略。正文、作者字段、配置和源码分别有明确写入口；历史、身份和证据不能通过任意 JSON 覆盖。详见 [Web 工作台契约](feature/web-workbench/README.md)及其[架构](feature/web-workbench/architecture.md)。

日志只实现当前格式，scope 区分文档和源码授权范围，不维护历史 journal 兼容分支。未知格式严格拒绝并保留现场。源码日志保存同一次读取的配置原文及摘要，发布和恢复均检查当前配置一致；文档初始化仍支持批量文件创建及回滚。

Research 以目录 README 为 owner，支持安全相对路径的自由附页；界面从物理目录派生主题分组，嵌套 owner 保留独立 ID 与关系。Research 无默认章节、必填日期或必填来源。历史 Design 暂缓与 Roadmap 取消由原文来源支持的 metadata 保留，详见[目录迁移](document-migration.md#目录迁移)。

## 文档写作检查

`concord docs check` 根据消费者显式采用的写作规则检查正文和术语，一次只读检查快照覆盖政策与输入文件。政策解码、纯文本解析和扫描编排各自独立，CLI 不拥有词库或文件遍历。init 将随包通用预设写入缺失的全局政策；检查只读取已保存政策，没有规则时不推断隐式预设；静态命中不作为执行证据。详见[文档写作契约](feature/documentation-quality/README.md)及[规则格式](feature/documentation-quality/policy.md)。


`writing.index/show/set/check` 与 `concepts.index/show/set` 通过 CLI 和 Web 共用领域操作。docs 下精确命名的 JSON 按目录拥有 scope；全局汇总只读派生，Markdown 保留概念解释。publication/recovery 双向检查路径、操作、Schema 和 CAS，concepts journal 还绑定其它 catalog 的集合与摘要。旧 v1 政策须显式迁移。完整合成、语料和恢复约束见[目录作用域采用方案](design/scoped-terminology/plans/directory-owned/README.md)。

## 工具式工程知识与本地观察

Memory/Issue 的索引与 recall 从当前 owner 派生，通过 Concord 工具读取和更新，不新增人工索引。Local 与 GitHub、Linear 是派生的来源视图；本地观察沿用现有 Issue owner，不创建虚假的连接或迁移持久化 source。正文、关系、生命周期与来源继续各自拥有事实。没有历史或关系的本地草稿可通过最新摘要删除，进入调查的记录保留既有生命周期。详见[记忆工具契约](feature/local-sdlc/use-case/recall-and-maintain-memory.md)与[本地观察契约](feature/feedback/use-case/manage-local-observations.md)。
