# Concord 独立化设计

本页是待挑战的候选设计；采用后由 architecture.md 拥有最终契约。

## 目标与来源

Concord 把 NiceEval 的契约、测试归属、工程记忆与审阅闭环变成可安装到任意 Git 仓库的本地 CLI。源仓库为 `/home/ctrdh/.herdr/worktrees/NiceEval/repot-tool`，基线为 `e1c66d31115208ceaae2f5bd4d730a7abf67048d`。新仓库为 `/home/ctrdh/Code/Concord`。

保留的原则是契约先于实现、每个事实有唯一 owner、反向关系动态派生、Problem 关闭需要真实运行证据、历史不被覆盖、机器输入严格校验。抽取包括通用领域行为与可复用代码；不把 NiceEval 产品 E2E 编排器、Mintlify、Netlify、产品发布和旧 Feedback 迁移一并搬入。

NiceEval 现有代码和数据保持原位，本次不迁移已有 Memory、不替换其命令、不降级其 formal evidence gate。Concord 使用自己的格式与证据语义，不能把原有 NiceEval 证书转换成普通命令结果。

## 候选方案

1. 整包复制 repo-tools 与 e2e-runner。可以保留接口，但带入产品构建、Testkit、Nx、模板及下游部署假设，不满足独立性。
2. 抽出契约和生命周期领域，在新项目重建宿主、存储和测试执行边界；复用可独立的引用校验和生命周期规则。采用此方案。
3. 只提供 Markdown 模板。不能建立关系检查和证据闭环，不满足任务。

## 领域与 CLI

`concord --root <repo>` 指定消费者，默认从 cwd 向上发现 `concord.json`；`init` 只初始化显式目录或 cwd。安装目录绝不充当消费者根。

- `init`：初始化本地 Git 仓库中的 concord.json 和空目录索引，不覆盖既有文件。
- `feature create/list/show`、`use-case create/list/show`：当前目标及其叶子用户路径。
- `research create/list/show`：带日期决策输入。
- `design create/decide/list/show`：候选比较、唯一裁决及关联目标。
- `roadmap create/adopt/list/show`：已定稿方向与显式采用。采用创建 Feature，Roadmap 标记 adopted 并保留历史；当前契约只在 Feature。
- `test list/show/run`：从测试声明旁的源码注释发现稳定 case ID、目标契约与 regression Memory；项目级配置拥有 argv、附加 sourceFiles 和 timeout。源码正常编辑与 Git 保存测试演进，Concord 不再建立测试关系 sidecar。
- `cache status/rebuild/clear`：维护可删除重建的 SQLite 解析缓存和关系投影。
- `memory add/list/show/search/resolve/reopen/supersede/promote/retire`：Problem、Decision、Insight 及历史。
- `author set`：用完整 owner preimage digest 更换契约或 Memory 正文，保留工具拥有的 metadata 与历史。
- `issue draft/list/show/link/close`：本地 Observation 草稿和 Memory 链接；明确不等于远端 GitHub 状态，不提供自动远端发布。
- `trace show/check`：从各 owner 编译图，检查目标存在、类型、重复及循环，动态反查测试和 Memory。不输出虚构覆盖率。
- `review render`：从契约、当前测试、证据和 Memory 生成本地 Markdown 审阅材料，不自动写 GitHub。
- `check` 与 `recover`：完整性和中断写入恢复。

## 存储契约

消费仓库中使用 Markdown 加严格 YAML frontmatter。Feature、Use Case、Design、Roadmap、Research、Memory 分别有 schema 与具名操作，不公开通用 CRUD。

路径是文档 canonical identity；slug 只允许 ASCII 小写字母、数字、单连字符。测试身份由紧邻测试声明的 `// @concord-case <id>` 拥有，`// @concord-contract <ref>` 和可重复的 `// @concord-regression <ref>` 保存唯一正向关系，可选 `// @concord-status retired` 表示关系退役。反向列表不写回契约，也不保存 JSON 测试关系副本。Git 保存源码演进；工具检查当前 ID 唯一性，不声称在删除所有历史后仍能判定 ID 复用。

注释解析使用 TypeScript AST，初期支持 JS/TS 中可明确绑定的静态 test/it 声明。悬空标注、重复 ID、动态/歧义声明产生明确 finding；静态索引不是 native runner inventory。项目配置保存 testRoots、runner argv、附加 sourceFiles、timeout。argv 的 {file}/{name}/{pattern} 占位符仅按参数替换，不经过 shell。运行收据明确 scope: command 和 selectedCaseId；不渲染为 native case passed，零测试或 skip 不能因此被称作 case 已通过。

SQLite 位于 Git-private `cache.sqlite`，只拥有可重建缓存。每次查询核对路径集合、内容摘要与解析器/schema版本，cache 命中仍需严格解码；缓存损坏、schema不符或写入失败回退到源文件编译，不返回陈旧结果。只缓存解析结果和投影，不缓存可绕过核验的授权或 Problem fixed 判定。clear 不删除 evidence、journal 或 Memory。一次 SQL transaction 更新同一代投影，源文件不是 SQL transaction 的一部分，必须通过前后摘要检测读取漂移。

Memory 保存 current promotion 和追加的生命周期 history，Problem 使用递增 epoch；reopen 增加 epoch，red/green 都必须绑定当前 epoch。

init 必须作用于 Git worktree 顶层；子目录项目与 bare repo 明确拒绝。

`concord.json` 是格式为 concord.project/v1 的项目标记；采用固定的 docs/feature、docs/roadmap、docs/design、docs/research、memory 约定。已有这些目录可以共存，但 init 遇到要创建的文件冲突时零写入失败，不导入或修改未知文件。

读写路径拒绝绝对路径、traversal、symlink 组件和超出 repo 的 realpath。扫描只读取 Concord 所属目录和格式；错误的受管格式明确报错。

Git-private 状态通过 `git rev-parse --git-path concord` 定位，每个 worktree 独立；journal 绑定 projectId、root 与 privateDir。只支持本地 POSIX 文件系统，不支持网络文件系统或 Windows。写入使用独占锁和 preimage journal，写前校验完整变更集，逐文件原子 rename；读遇到未完成 journal 要求 recover。恢复仅在内容符合 preimage 或 planned digest 时进行，否则拒绝覆盖未知编辑。dry-run 执行同一规划校验，不写文件。锁不因超时擅自抢占；明确 recovery 检查同主机 PID 已消失后才能清理遗留锁。

## 测试执行和证据边界

项目配置中的运行命令是一个用户声明的验收单元，工具记录这一命令的结果，不声称收集或证明底层 runner 的每个子 case。它不是 NiceEval 的 formal E2E inventory、可靠性证书，也不证明完整覆盖。

run 在当前消费者 cwd 下执行项目配置中的 argv，shell=false；设置 timeout，取消或超时清理进程组，不能把信号或启动失败记为通过。仅 run 会执行仓库命令；help/list/show/check/render 均不执行。命令由本地项目作者信任与维护；本轮验证只执行我们创建的隔离消费仓库，无付费 provider、远端 mutation 或生产副作用。

证据由 Concord 自己运行产生，在 Git-private 下以不透明 ID 保存。收据包含 schema/version、scope: command、selectedCaseId、definition digest（含标注、完整测试文件、项目runner配置与声明 sourceFiles 的字节）、contract digest、argv/cwd、候选摘要（所有 Git tracked 与 nonignored untracked 文件，仅排除精确识别的 Concord owner 文件，不排除目录；owner 不能作为测试 sourceFiles）、开始/结束、exitCode、timeout/cancel/cleanup 结果、stdout/stderr digest。内部证据签名用于检测意外损坏，不宣称抵抗有本地写权限的恶意用户。

`memory resolve --kind fixed --red <id> --green <id>` 要求当前 active 标注的 regression 指向该 Problem、同一测试定义和目标契约、red 为普通非零退出（非超时/信号/启动失败）、green 成功且清理成功，red 先于 green，green 候选摘要匹配当前消费者内容。sourceFiles 是作者声明的测试、启动脚本与断言配置；工具只校验这些字节不变，不证明依赖闭包、断言完整性或根因。fixed 要求作者用非空 --reason 明确裁决修复，resolution 持久化 evidenceLevel: command，show、check、review 与 JSON 一致显示。产品文件可变化。red 与 green 都由 CLI 签发，不能导入手写 JSON。run 前后必须校验 candidate、definition 与 contract 摘要相同；运行期间发生变化的证据不能用于关闭。摘要不证明 ignored dependencies、外部服务或完整执行环境。重复运行不是初版 fixed gate；这种证据等级明确标为 command，而不叫 formal E2E。新 clone 缺少私有证据时，历史 resolution 仍可读，但 check/review 必须显示 unavailable，不能当作当前验证。

Memory 其他关闭理由需要非空说明；reopen 追加历史并移除 current resolution；supersede 只允许相同 kind 且不得形成循环；promotion 只能指向有效当前契约，不复制正文。

## 验收

独立安装无 workspace:*、NiceEval 路径或运行时 import。构建为带 shebang 的 Node CLI，pack 到 tarball，在仓库外临时消费者安装后使用其 bin。

真实闭环：init → feature → use-case → problem → 给真实 Node 测试添加契约/回归注释并配置 runner → 缺陷 red → 修生产 fixture → green → resolve → trace 与 review。另覆盖错误引用、无证据关闭、伪造/陈旧证据、测试源码变化、重开、退役、缓存删除/损坏/旧版本、注释修改/重命名/删除后的缓存失效、动态/悬空/重复标注、跨 cwd/root、路径穿越、写冲突、并发写、journal recovery、超时清理和独立安装。

TypeScript typecheck、Node 原生测试、package smoke 通过；测试从安装后的 CLI 运行。保留来源说明、README、Agent 工作流指引与本地 CI，不发布或 push。
