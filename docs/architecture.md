# Concord 架构与行为契约

源码注释与 Markdown 拥有协作事实，SQLite 只保存可重建缓存。

## 领域与 CLI

`concord --root <repo>` 指定消费者，默认从 cwd 向上发现 `concord.json`；`init` 只初始化显式目录或 cwd。安装目录绝不充当消费者根。

- `--skill [topic]`：在任意 cwd 读取随包 Agent 指引，不加载 host、不写文件。默认短路由，按 init/document/test/memory/trace/recovery/repository 读取，all 展开全部。未知 topic 或混用写命令具名拒绝。
- `init`：一次建立本地 Git 仓库中的 concord.json、完整分类目录、docs/concord.md 指南、缺失的 docs/README.md 和 docs/_template 全套模板。已有文件保留或具名报冲突；不要求选择页面。`--test-root` 可重复，`--runner-config` 接受严格 runner JSON；默认配置仍是 Node 原生测试。纯文档仓库使用 `--docs-only` 保存空 testRoots，不要求测试目录；以后添加真实测试根即可启用发现。该选项与 `--test-root` 互斥。
- `feature create/list/show`、`use-case create/list/show`：当前目标及其叶子用户路径。
- `research create/list/show`：带日期决策输入。
- `engineering create/list/show`：仓库测试与维护机制的目标、使用与验收。
- `template list/show`：在任意 cwd 查看随包写作模板，无需初始化项目。
- `doctor`：检查项目配置、缺失测试目录和当前关联，给出接入步骤，不执行 runner。
- `design create/decide/list/show`：候选比较、唯一裁决及关联目标。
- `roadmap create/adopt/list/show`：已定稿方向与显式采用。采用创建 Feature，Roadmap 标记 adopted 并保留历史；当前契约只在 Feature。
- `test list/show/run`：从测试声明旁的源码注释发现稳定 case ID、目标契约与 regression Memory；项目级配置拥有 argv、附加 sourceFiles 和 timeout。源码正常编辑与 Git 保存测试演进，Concord 不再建立测试关系 sidecar。
- `test annotate`：验证新 case ID、Feature / Use Case 目标与 Problem 引用后输出注释片段。它不改测试源文件，也不自动运行测试。
- `cache status/rebuild/clear`：维护可删除重建的 SQLite 解析缓存。
- `memory add/list/show/search/resolve/reopen/supersede/promote/retire`：Problem、Decision、Insight 及历史。
- `author set`：用完整 owner preimage digest 更换契约或 Memory 正文，保留工具拥有的 metadata 与历史。
- `issue draft/list/show/link/close`：本地 Observation 草稿和 Memory 链接；明确不等于远端 GitHub 状态，不提供自动远端发布。
- `trace show/check`：从各 owner 编译图，检查目标存在、类型、重复及循环，动态反查测试和 Memory。不输出虚构覆盖率。
- `review render`：从契约、当前测试、证据和 Memory 生成本地 Markdown 审阅材料，不自动写 GitHub。
- `check` 与 `recover`：完整性和中断写入恢复。

## 存储契约

消费仓库中使用 Markdown 加严格 YAML frontmatter。Feature、Use Case、Design、Roadmap、Engineering、Research、Memory 分别有 schema 与具名操作，不公开通用 CRUD。

文档创建省略 `--body` 时使用随包模板；显式文件/stdin 正文仍可用。模板是作者提示，不是完成状态或验收证据。Feature、Roadmap 和 Design 候选使用相同体裁，README、library、cli、architecture、lifecycle 和 use-case 索引全部生成。Engineering 使用工程主题模板及完整页面结构。Design 外层包含 GOALS、LIMITS、DECISION 和 CASES，候选放在 `plans/<alternative>/`；候选身份仍由主 owner 的 alternatives 声明，普通页面不新增 metadata 真源。旧 Design 缺少模板页仍然有效，DECISION 正文不会改变 metadata.decision 中的裁决。

`feature/roadmap/design/engineering page add/show/set` 维护已存在 package 的页面；也支持安全小写 slug 的自定义专题页，路径固定为 package 内的 `<slug>.md`，继续使用整文件 CAS。Design 外层保留 goals/limits/decision/cases 的既有路径，候选模板页须指定 plan。Design 候选通过 `--plan` 选择。set 必须提供最新整文件 digest，主 README 正文写入保留 metadata。普通 supporting Markdown 继续进入 candidate 摘要，不因为由模板生成而变成独立 owner 或测试证据。测试 contract 仍限于 Feature / Use Case；Engineering owner 可作为 Design 裁决和 Memory promotion 的目标。

模板安装在工具包内，由严格 manifest 校验名称、路径、库存和普通文件类型，不依赖消费仓库或 NiceEval checkout。init 一次生成完整分类目录、docs/concord.md、docs/_template/ 全套可读参考模板，以及缺失的 docs/README.md。已有 docs/README.md 保留，不修改 AGENTS.md。参考模板不成为契约 owner，create 使用随包模板，不把参考文件解释为自定义配置。

路径是文档 canonical identity；slug 只允许 ASCII 小写字母、数字、单连字符。测试身份由紧邻测试声明的 `// @concord-case <id>` 拥有，`// @concord-contract <ref>` 和可重复的 `// @concord-regression <ref>` 保存唯一正向关系，可选 `// @concord-status retired` 表示关系退役。反向列表不写回契约，也不保存 JSON 测试关系副本。Git 保存源码演进；工具检查当前 ID 唯一性，不声称在删除所有历史后仍能判定 ID 复用。

注释解析使用 TypeScript AST，初期支持 JS/TS 中可明确绑定的静态 test/it 声明。悬空标注、重复 ID、动态/歧义声明产生明确 finding；静态索引不是 native runner inventory。项目配置保存 testRoots、runner argv、附加 sourceFiles、timeout。argv 的 {file}/{name}/{pattern} 占位符仅按参数替换，不经过 shell。运行收据明确 scope: command 和 selectedCaseId；不渲染为 native case passed，零测试或 skip 不能因此被称作 case 已通过。

SQLite 位于 Git-private `cache.sqlite`，只拥有可重建缓存。每次查询核对路径集合、内容摘要与解析器/schema版本，cache 命中仍需严格解码；缓存损坏、schema不符或写入失败回退到源文件编译，不返回陈旧结果。只缓存解析结果和投影，不缓存可绕过核验的授权或 Problem fixed 判定。clear 不删除 evidence、journal 或 Memory。一次 SQL transaction 更新同一代投影，源文件不是 SQL transaction 的一部分，必须通过前后摘要检测读取漂移。

Memory 保存 current promotion 和追加的生命周期 history，Problem 使用递增 epoch；reopen 增加 epoch，red/green 都必须绑定当前 epoch。

init 必须作用于 Git worktree 顶层；子目录项目与 bare repo 明确拒绝。

`concord.json` 是格式为 concord.project/v1 的项目标记；采用固定的 docs/feature、docs/roadmap、docs/design、docs/engineering、docs/research、memory 约定。已有这些目录可以共存，但 init 遇到要创建的文件冲突时零写入失败，不导入或修改未知文件。

Roadmap adoption 递归包含实际 Markdown 页面并保留目录结构；旧 Roadmap 保存 adopted 历史，新 Feature 拥有当前契约。内部链接指向新副本，集合外相对链接保持原 canonical 目标；不能安全处理的链接、非 Markdown 附件、嵌套 owner、symlink 与目标冲突具名拒绝，不静默丢弃。规划再次检查源集合与摘要，并将 supporting source 的同内容 guard 纳入 publication；guard 会按现有协议原子重写并列入 changedPaths，不是只读断言。观察到的来源变化阻止发布；不额外宣称对不合作编辑器的线性化保证。

Trace 与定向 Review 按解析得到的 owner 汇总 Feature supporting page 与 Use Case 的测试关系，保留 exact path/anchor，不用目录前缀混入相邻 Feature。默认输出供人阅读，`--json` 保留结构化结果的含义。

读写路径拒绝绝对路径、traversal、symlink 组件和超出 repo 的 realpath。扫描只读取 Concord 所属目录和格式；错误的受管格式明确报错。

Git-private 状态通过 `git rev-parse --git-path concord` 定位，每个 worktree 独立；journal 绑定 projectId、root 与 privateDir。初版只支持 Linux 本地文件系统，不支持网络文件系统、macOS 或 Windows。写入使用独占锁和 preimage journal，写前校验完整变更集，逐文件原子 rename；读遇到未完成 journal 要求 recover。恢复仅在内容符合 preimage 或 planned digest 时进行，否则拒绝覆盖未知编辑。dry-run 执行同一规划校验，不写文件。锁不因超时擅自抢占；明确 recovery 检查同主机 PID 已消失后才能清理遗留锁。

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

`pnpm check` 构建后检查测试与脚本类型，再执行领域、恢复和 package smoke；公开 CLI 验收使用独立安装后的命令。保留来源说明、README、Agent 工作流指引与 CI 检查配置，不发布或 push。


## 注释方案的约束裁决

注释 current 身份只保证当前扫描集合唯一。撤销旧 JSON 方案中“ID 永不复用”和由工具保存测试 update 历史的承诺：测试演进由 Git 保存，工具不提供跨删库、删源码、删历史的永久身份登记服务。证据绑定完整测试文件、路径、声明、runner 配置、契约和 Problem epoch，不能单凭同名 ID 重用。测试文件即使拥有注释，也完整进入 candidate/definition 摘要；不能套用 Markdown owner 的排除规则。

初版不提供测试源码写命令；开发者正常编辑注释并以 Git 审阅，scan/check 不改写源文件或补写历史。文档与 Memory 的具名写命令仍使用 journal；其唯一提交点是全部 planned 文件发布并持久化 committed journal。缓存在源事实提交以后刷新；cache 失败不回滚源文件。

AST 识别必须核对受支持 runner import 的绑定，不因任意函数叫 test 就视为测试。known skip/todo 的声明不允许生成 fixed 证据；命令结果显示 observed execution 为 unknown，或由明确支持的默认 Node TAP 计数观察为 nonzero/zero/skipped。已知零执行或全跳过的收据不能用于 fixed。通用命令的 unknown 不被显示成原生 case passed。

缓存身份包含 projectId、root/privateDir（worktree）、testRoots/runner配置、完整路径集合、每文件字节摘要和解析器版本。无论冷热缓存，关系验证都使用当前 Markdown。fixed gate 从权威源码重新构建并核对，不信任 cache 的状态判断。

## Repository profile

`concord repo` 通过消费仓库声明的 host 使用原生 inventory 与正式证据，独立于上述通用 command evidence。源码注释、历史归档、固定执行副本的 v2 证据及既有 v1 历史读取规则见 [Repository profile](repository-profile.md)。包内 `concord --skill repository` 提供具体命令，不初始化通用项目或加载产品 host。
