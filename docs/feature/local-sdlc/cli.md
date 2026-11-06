# 命令体验

本页按日常顺序列出命令、实际输出、退出码与错误。示例来自一个只有 `src/cart.js` 与 `test/cart.test.js` 的消费仓库。摘要和时间戳因运行而异，其余字段与真实输出一致；标为预期输出的示例尚待实现核对。实现方式见[架构](architecture.md)。

全部文件都可以直接编辑。命令是执行需要运行的步骤的助手，例如修复核验与 Roadmap 采用，并把结果写进文件；`check` 检查结果是否一致。

## 命令面

| 命令 | 作用 |
| --- | --- |
| `init` | 创建布局、`AGENTS.md` 区块与可选配置 |
| `new <类别> <名称>` | 按模板创建 Feature、Use Case、Engineering、Roadmap、Design、Issue 或 Memory |
| `show <路径或选择器>` | 一个文档及其关系、测试与实现 |
| `list [类别]` | 列出文档 |
| `check` | 放置、关系、概念、写作与修复核验记录 |
| `trace` | 关系图与缺口 |
| `test` | `list`、`show`、`discover`、`marker`、`run`、`verify <issue>` |
| `code` | `marker`、`list`、`at`、`analyze`：实现与 Spec 的关联 |
| `use-case` | `steps`、`format`、`rename-step`：Use Case 步骤 |
| `issue` | `close`（删除 Issue，fixed 时先核验）、`link`、`unlink`、`search`；`remote preview` 与 `remote apply` 写入远端 |
| `memory` | `link`、`search`；摘要列表用 `list memory` |
| `roadmap` | `start <roadmap> [--feature <id>]`：移入 `docs/feature/`，省略 `--feature` 时 Feature ID 与 Roadmap 同名；取消方向即删除目录，历史在 Git |
| `taste` | 列出品味条目与依据它们的页面 |
| `concepts`、`writing` | 概念与写作政策的查看与受管写入 |
| `docs` | `docs check` 与 `docs work` |
| `feedback` | 外部来源的同步与导入 |
| `view` | Web 工作台 |
| `server` | `start`、`run`、`status`、`stop`：管理项目目录的[工作区服务](../../concepts.md#workspace-server)，查询命令也会自动启动它；`server stop` 等目标实例回收子进程、关闭持久缓存、删除实例记录并释放服务锁后才返回 0，返回后其它命令可以立即打开持久缓存；它也能停止另一版本或另一渠道安装的 Concord 启动的实例 |
| `skills` | `install`：在项目中创建或更新 Concord 工作流 skill，见[用斜杠命令走开发流程](../project-onboarding/use-case/run-workflow-from-agent.md) |
| `herdr` | `install`、`uninstall`：安装 [Herdr mod](../herdr-mod/README.md) |
| `workspace`、`git` | 工作区的当前扫描与历史投影、只读 Git 状态与差异，见 [Web 工作台 CLI](../web-workbench/cli.md) |
| `config`、`template` | 查看与替换配置；查看随包模板 |
| `cache`、`recover`、`doctor`、`lsp`、`review`、`action` | 维护与集成 |

顶层共 31 个命令。

本页其余各节给出这些命令的调用、输出与错误。

## 通用约定

- 每个命令都接受 `--json`。Agent 与脚本读取 JSON，不解析人读输出。JSON 字段是公开 Spec。
- 退出码 0 表示成功。退出码 1 表示命令拒绝执行、检查发现问题或测试失败。
- 命令拒绝执行时，错误对象写到 stderr，形如 `{"ok":false,"error":"<错误码>","message":"...","details":{...}}`。`details` 可省略。人读输出以 `ok: false`、`error:`、`message:` 三行开头。`check` 这类检查命令发现问题时，结果仍写到 stdout，`ok` 为 false。
- `--root <worktree>` 指定消费仓库。省略时取 cwd 所在 Git worktree 的顶层；`concord.config.ts` 可以不存在。
- CLI 查询默认使用 `--server=shared`，自动启动或复用项目后台；`--server=command` 使用随查询回收的后台。作用域、环境隔离与失败语义见[CLI 查询](../local-data-engine/architecture.md#cli-查询)。
- `--dry-run` 放在子命令之前，校验并预览写入，不改文件。人读输出以 `Would apply` 开头。
- 诊断类读取默认返回后台刷新的快照。尚无快照时返回 `QueryPending`，`details.refresh` 为 `requested`。加 `--fresh` 等待当前来源。

## 接入

`concord --skill` 输出 Agent 入口：主题列表、设计理由与工作原则。`concord --skill <topic>` 输出一个主题，`concord --skill all` 输出全部主题。主题包括两份[写作指南](../../concepts.md#writing-guide)：`docs-from-scratch` 与 `docs-from-code`。这个入口在任意 cwd 可用，不读取项目，也不写文件。未知主题返回 `SkillTopicUnknown`。

`concord init` 在 Git worktree 顶层初始化项目，人读输出列出创建的文件，最后给出下一步和推荐的写作指南（预期输出）：

```text
  docs/README.md
  docs/concepts.md
  docs/writing.md
  ...
  memory/README.md
  AGENTS.md

Start here: docs/concord.md
Writing guide: concord --skill docs-from-scratch
Inspect configuration: concord doctor
```

`--json` 输出在 `changedPaths`、`createdPaths`、`preservedPaths` 之外给出 `guide`，取值 `docs-from-scratch` 或 `docs-from-code`；`--dry-run init` 同样给出。选择规则见[初始化后按项目情况开始写 Spec](../project-onboarding/use-case/start-writing-specs.md#选哪份指南)。

```json
{"operation":"init","dryRun":false,"changedPaths":["docs/taste.md","..."],"config":{},"createdPaths":["docs/taste.md","..."],"preservedPaths":[],"guide":"docs-from-code"}
```

`concord skills install` 创建或更新 `.agents/skills/concord-{spec,implement,review,fix}/SKILL.md` 与内容相同的 `.claude/skills/concord-*/SKILL.md`，全部是普通文件，在一次写入中提交；`init` 安装同一组文件。当前版本不再提供、但带 `concord-managed` 标记的 `concord-*` skill 被删除。人读输出按 `Created`、`Updated`、`Removed`、`Unchanged` 分组列出路径。`--json` 返回：

```json
{"operation":"skills-install","dryRun":false,"createdPaths":[".agents/skills/concord-spec/SKILL.md","..."],"updatedPaths":[],"removedPaths":[],"unchangedPaths":[]}
```

`check` 与 `doctor` 在 advisories 中给出 `WorkflowSkillsOutdated`，`details.paths` 列出需要重写或删除的文件，不影响退出码；判定见[更新 skill 文件](../project-onboarding/use-case/run-workflow-from-agent.md#update)。

| 错误 | 触发条件 |
| --- | --- |
| `SkillPathOccupied` | 目标路径已有不带 `concord-managed` 标记的文件，或是目录、符号链接；`details.path` 给出路径，不写任何文件 |

在还没有初始化的仓库里，需要项目的命令返回 `ProjectNotInitialized`（退出 1），`details.guide` 给出初始化后推荐的写作指南；哪些命令照常执行见[在还没初始化的仓库里打开 Concord](../project-onboarding/use-case/open-uninitialized-repo.md)。

`concord doctor --json` 报告配置与接入缺口，不运行测试；项目安装的库包 `concord-sdlc` 与 CLI 版本不一致时给出 `LibraryVersionMismatch`，见[库接口](library.md#版本)：

```json
{
  "operation": "doctor",
  "ok": true,
  "configuration": {"testRoots": ["test", "tests"], "sourceRoots": ["src"], "runner": {"kind": "node-test", "timeoutMs": 60000}},
  "missingTestRoots": ["tests"],
  "missingSourceRoots": [],
  "documents": 3,
  "cases": 1,
  "codeDeclarations": 1,
  "findings": [],
  "nextSteps": ["Run concord check to validate all relations.", "Configure runner to run tests and verify fixes."]
}
```

`concord template list/show` 在未初始化的目录也能读取随包模板。

## 创建与编辑文档

`concord new <类别> <名称>` 按模板创建 Feature、Use Case、Engineering、Roadmap、Design、Issue 或 Memory。`show <路径或选择器>` 返回一个文档及其关系、测试与实现，`list [类别]` 列出文档。以下为预期输出：

```sh
concord new feature cart --title "购物车" --pages cli,use-case
```

```text
Applied new:
  docs/feature/cart/README.md
  docs/feature/cart/cli.md
  docs/feature/cart/use-case/README.md

Next: edit the pages, then run concord check.
```

```sh
concord --json new use-case add-item --feature cart --title "加入商品"
```

```json
{"operation":"new","dryRun":false,"changedPaths":["docs/feature/cart/use-case/add-item.md"]}
```

`--pages` 只用于 `new feature`、`new engineering` 与 `new roadmap`，取逗号分隔的页面种类：`use-case`、`cli`、`library`、`api`、`format`、`ui`、`performance`、`architecture`、`data-model`。省略时只建 README；README 只链接选中的页面。`use-case` 只创建 `use-case/README.md` 导航页，不创建旅程。`concepts.md` 与 `writing.md` 不经 `--pages` 创建，直接编辑。

| 情形 | 结果 |
| --- | --- |
| 未知种类，例如 `--pages scope` | `InvalidInput`，退出 1，不改文件 |
| 重复种类，例如 `--pages cli,cli` | `InvalidInput`，退出 1，不改文件 |
| 对其它类别使用 `--pages` | `InvalidInput`，退出 1，不改文件 |

路径已存在时返回 `DocumentExists`，退出 1，不改文件。短选择器在同一类别中匹配多个文档时返回具名错误，需要写出路径。路径、类别与名称的规则见[文档与标记格式](format.md#owner)。

### 查看一个文档包

`show` 一个 Feature、Engineering 或 Roadmap 时，结果另有 `pages`，列出包内的全部页面，按路径排序。以下为预期输出：

```sh
concord --json show cart
```

```json
{
  "operation": "show",
  "pages": [
    {"path": "docs/feature/cart/README.md", "kind": "readme", "name": "购物车"},
    {"path": "docs/feature/cart/architecture.md", "kind": "architecture", "name": "购物车的实现"},
    {"path": "docs/feature/cart/cli.md", "kind": "cli", "name": "购物车命令"},
    {"path": "docs/feature/cart/use-case/add-item.md", "kind": "use-case", "name": "加入商品"}
  ]
}
```

（省略关系、测试与实现字段。）`name` 是页面的一级标题。人读输出在关系之前列出这些页面。`show` 其它类别的文档时没有 `pages`。

`kind` 按[路径与识别](../../document-model.md#路径与识别)取值：

| `kind` | 页面 |
| --- | --- |
| `readme` | 包入口 `README.md` |
| `use-case-index` | `use-case/README.md` 导航页 |
| `use-case` | `use-case/<u>.md` 旅程 |
| `cli`、`library`、`api`、`format`、`ui`、`performance`、`architecture`、`data-model` | 种类单页，或该种类目录中的页面，包括目录入口 `<种类>/README.md` |
| `concepts`、`writing` | 包内各层的 `concepts.md` 与 `writing.md` |
| `unknown` | 无法归类的页面；`check` 同时报告 [`UnknownPageKind`](../documentation-quality/cli.md#页面种类) |

种类目录中的页面取目录的种类，例如 `docs/feature/cart/architecture/checkout-flow.md` 的 `kind` 为 `architecture`。

创建之后直接编辑文件。Web 工作台的保存带整文件摘要；文件在读取后被外部改过时返回 `FileChangedSinceRead`，需要重新读取并合并。摘要只防止覆盖并发编辑，不是授权边界。

## 关联源码

`code marker` 与 `test marker` 只把校验过的标记写到 stdout，不改源码。引用的 Spec 不存在时返回 `ReferenceNotFound`。

```sh
concord code marker --scope file --contract docs/feature/cart/README.md
```

```text
// @concord-file
// @concord-implements docs/feature/cart/README.md
```

`--scope node` 关联标记下方的一个声明，`--scope region` 关联一段代码。实现源码根由 `concord.config.ts` 的 `sourceRoots` 配置，`init --source-root src` 可在初始化时设置。

```sh
concord test marker --contract docs/feature/cart/use-case/add-item.md --issue docs/issues/duplicate-sku.md
```

```text
// @use-case docs/feature/cart/use-case/add-item.md
// @issue docs/issues/duplicate-sku.md
```

`--json` 返回 `{"operation":"test-marker","snippet":"..."}`。`code list` 返回当前代码声明，`code at <path>:<n>` 返回包含该行的全部声明。代码声明只表示实现关联，不代替测试，也不证明 Spec 已完成。完整语法见 `concord --skill code`。

## 检查关系

`concord check` 检查引用、生命周期与写作政策，不运行测试。

```text
Check
ok: true
complete: true
findings: none
checks:
  relations:
    ok: true
    complete: true
  writing:
    ok: true
    complete: true
advisories:
  docs/taste.md
documents: 3
cases: 1
codeDeclarations: 1
```

测试标记指向不存在的文件时，`check` 退出 1，`--json` 输出：

```json
{
  "operation": "check",
  "ok": false,
  "complete": false,
  "findings": [{"code": "ReferenceNotFound", "path": "test/cart.test.js", "line": 5, "message": "Reference target does not exist: docs/feature/cart/use-case/add-items.md", "category": "relation"}],
  "checks": {"relations": {"ok": false, "complete": false}, "writing": {"ok": true, "complete": true}}
}
```

适用范围与规则见[聚合门禁](../documentation-quality/cli.md#合并检查)。

`ok` 为 false 表示发现违规。`complete` 为 false 表示有必需输入没能读取，结论不完整。`advisories` 是提示，不影响退出码。

## 追踪关系

`concord trace show --fresh <path>` 返回一份 Spec 的正文、关系、测试与代码声明。`subject` 的 `kind`、`title` 与 `feature` 由路径和一级标题推导，以下为预期输出。不加 `--fresh` 且尚无快照时返回 `QueryPending`。`--json` 的顶层字段为 `operation`、`subject`、`relatedPaths`、`incoming`、`outgoing`、`tests`、`codeDeclarations`、`stepGroups`、`cache` 与 `analysis`：

```json
{
  "operation": "trace-show",
  "subject": {"path": "docs/feature/cart/use-case/add-item.md", "kind": "use-case", "title": "加入商品", "feature": "docs/feature/cart/README.md", "digest": "sha256:..."},
  "incoming": [{"from": "case:neref_854212737ecad7effc4666629752cb98", "to": "docs/feature/cart/use-case/add-item.md", "relation": "contract"}],
  "outgoing": [{"from": "docs/feature/cart/use-case/add-item.md", "to": "docs/feature/cart/README.md", "relation": "feature"}],
  "tests": [{"id": "neref_854212737ecad7effc4666629752cb98", "file": "test/cart.test.js", "line": 5, "contract": "docs/feature/cart/use-case/add-item.md", "issues": ["docs/issues/duplicate-sku.md"], "status": "active"}],
  "codeDeclarations": [],
  "analysis": {"observations": [], "relevance": [{"testId": "neref_854212737ecad7effc4666629752cb98", "scope": "file", "relevance": {"verdict": "not-observed", "gaps": ["NoAnalyzer"]}, "message": "未观察到交集"}]}
}
```

`codeDeclarations` 为空表示没有代码直接声明实现这个 Use Case。示例中的代码声明指向 Feature README，在 Feature 的 `trace show` 中列出。`trace gaps --json` 列出缺少实现或测试关联的 Spec。`trace check` 只做关系检查。`review` 生成审阅材料。这些命令都不运行测试。

## Use Case 步骤

`use-case` 的三个子命令只处理单个 Use Case 的步骤，不处理文件移动或 Feature 改名。完整路径与输出示例见[把测试关联到 Use Case 步骤](use-case/link-tests-to-steps.md)，步骤的写法见[步骤语法](format.md#步骤语法)。

`use-case steps <use-case>` 只读，列出步骤的 ID、ordinal、行号、测试与代码关联数，以及每个根有序列表的 ordinal、行范围与是否含 ID。

`use-case format <use-case>` 只为已含步骤 ID 的根有序列表补齐缺失 ID：

- 补齐值为 `step-N`，N 从已有 `step-N` 的最大值加 1 起逐项分配，没有时从 1 开始；跳过标题显式 ID、slug、别名、其它步骤与旧引用仍占用的值。序号不保证永久不复用；所需引用扫描不完整时拒绝。
- 已有 ID 不修改、不重排。规范化后 ID 前恰好一个空格，位于第一段末尾；位置错误的语法只报告 `InvalidStepPosition`，不移动文本。连续运行第二次零写入。
- 为完全未标记的列表建立步骤身份须同时给出 `--seed` 与 `--list <ordinal>`，显式选择一个根有序列表并受当前正文前像保护；选择缺失或无效时返回 `InvalidStepList`。其它未标记列表不变，工具不按章节名称猜测完整路径。

`use-case rename-step <use-case> <old-id> <new-id>` 在一个变更集中改写正文的 `{#old-id}` 以及全部指向 `<use-case>#<old-id>` 的精确引用：

- `new-id` 须符合步骤 ID 语法，且不与该文件的标题 anchor 或其它步骤冲突，冲突时返回 `DuplicateAnchor`。
- 改写对象是 testRoots 中的 `@use-case` 标记、sourceRoots 中的 `@concord-implements`，以及 `docs/` 中解析后指向旧引用的 Markdown 链接。标记识别遵守[关联由源码声明拥有](format.md#关联由源码声明拥有)，JS/TS 字符串、模板、正则与 Markdown 代码示例中的相同文本不变；不解析测试声明，不启动 adapter 或 LSP。扫描不完整或无法可靠定位 token 时拒绝整次操作。
- Issue 与 Memory 的 frontmatter 关系或正文链接中出现旧引用时返回 `ManagedReferenceBlocked`，零写入，由作者直接修改或用对应命令处理。
- 没有 `@name` 的测试标记随目标改变测试引用，带 `@name` 的保持不变；`--json` 的 `affectedCases` 列出受影响的 case，每项含 `before`、`after`、`file` 与 `named`。
- 只改写已识别的引用 token、步骤 ID 与链接目标，不创建、删除或移动文件，不改 frontmatter、Memory、Issue 与配置。提交前冲突零写入；发布开始后冲突或中断返回 `RecoveryRequired`，`recover` 回滚 prepared、保留 committed 结果，遇到未知编辑拒绝并保留现场。`--dry-run` 执行同一规划与校验，不发布。

发布范围见[步骤改写的发布](architecture.md#步骤改写的发布)。

## 测试与修复核验

`concord --json test list` 列出测试根中的标记。`cases[].id` 是 `test run` 使用的 case ID：

```json
{"operation":"test-list","cases":[{"id":"neref_854212737ecad7effc4666629752cb98","file":"test/cart.test.js","line":5,"contract":"docs/feature/cart/use-case/add-item.md","contractKind":"use-case","issues":[],"status":"active","framework":"marker","skipped":false}],"observations":[]}
```

`concord test run <case-id>` 用配置的 runner 运行 case 所在文件，argv 不经过 shell。人读输出：

```text
Command fail — neref_854212737ecad7effc4666629752cb98
Scope: command (does not prove native case coverage)
Execution: ran; exit: 1; cleanup: true
Timeout: false; cancelled: false; signal: null
Arguments: ["node","--test","--test-reporter=tap","test/cart.test.js"]
```

测试通过时首行为 `Command pass`，退出 0；测试失败时退出 1。运行结果不保存。`--json` 输出 `commandOutcome`、`execution`、`exitCode`、`timedOut`、`cleanupOk` 与 `arguments`。`commandOutcome` 取 `pass`、`fail` 或 `invalid`。`execution` 只描述执行的测试数量，与退出码无关：取 `ran`、`none`、`skipped` 或 `unknown`，分别表示执行的测试数大于 0、等于 0、全部跳过或无法判断。

`issue close <issue> --fixed --reason <text> [--defect <commit>]` 先核验回归测试在缺陷提交上失败、在当前 HEAD 上通过，再删除 Issue 文件并输出可写进提交说明的结论。`test verify --defect <D> --fix <F> <test-id>...` 按提交与测试重放核验，不改变结论。完整路径、输出与错误码见[核验修复并关闭缺陷](use-case/resolve-with-command-evidence.md)。

## 缓存与恢复

`cache status/clear/rebuild` 只管理可删除的缓存。`cache rebuild` 在缓存目录缺失时创建它，重建后仍不可读时返回 `CacheRebuildUnavailable`，成功的 JSON 结果附 `cacheStatus`。缓存不可用时，命令从源文件重新计算，结论不变。

`cache status --dry-run --json` 不打开数据库：缺失或空存储返回 `status: "empty"`，已有内容返回 `status: "unavailable"` 并附 `detail: "Persistent cache access is disabled"`。命令成功退出 0；该结果不表示数据库损坏。缓存读取、锁保留和降级行为见[统一缓存](../local-data-engine/use-case/use-unified-cache.md)。

`recover` 完成或回退中断的写入。现场内容与计划不符时拒绝覆盖，保留文件。

## 读取错误

- 读取过的文件在同一次命令内被按大小写改名时，命令结束时返回 `FileChangedSinceRead`，`details` 为 `source-observation`。
- 非普通文件在读取或扫描时返回 `InvalidFile`，在核验阶段返回 `UnsafePath`。symlink 与越出仓库的路径在任何阶段都返回 `UnsafePath`。
- macOS 低于 11 时返回 `UnsupportedHost`。
- 固定版本的 TypeScript 原生编译器不可用时，相关解析返回 `TypeScriptUnavailable`。编译器作用域违反同步生命周期约束时返回 `TypeScriptScopeViolation`。

路径检查的实现见[路径安全](architecture.md#路径安全)。

## 依赖分析

`code analyze` 显式生成可丢弃依赖观察；不接受 `--dry-run`，不运行测试。JS/TS 使用内置 TypeScript 模块解析，不启动 server。其它语言根据 `languageServers` 配置启动受管 LSP 进程，具体配置见[多语言分析](use-case/analyze-other-languages.md)。

`code list`、`trace show --fresh` 与 `test show` 展示 `analysis.observations` 和 `analysis.relevance`。`observed` 附层级及范围限制，`not-observed` 显示“未观察到交集”和具名缺口。历史诊断投影中的观察只作历史展示；当前判定须重新读取当前输入。

`budgets` 包含固定上限：

| 字段 | 上限 |
| --- | --- |
| totalMs | 120000 |
| requestMs | 10000 |
| outputBytes | 8388608 |
| messageBytes | 1048576 |
| messages | 20000 |
| requests | 2000 |
| concurrency | 8 |
| files | 1000 |
| symbols | 20000 |
| nodes | 2000 |
| depth | 32 |

配置值为正整数且不能突破上限；默认深度为 3，其它默认值为包级上限。

清理不确定时返回 `AnalysisCleanupUnknown` 并阻断后续发布；输入变化时返回 `AnalysisSourceChanged`。server 故障与缓存不可用不改变静态关系或 `check` 的结论。

`current` 表达仓库内输入一致性；复核通过的 LSP 观察为 `current: true`，可用于符号定位与相关性判定。仓库外 SDK、外部环境与私有索引无法核验时保留 `UnverifiedEnvironment`，`complete` 为 false。仓库内输入变化后，旧观察只作历史展示。

## 原生测试 adapter

`concord test discover [<file>...]` 显式运行配置的 adapter，保存可丢弃的原生清单观察。`test list/show` 只读展示 `current`、`complete` 与 `gaps`；`check` 与 `trace` 不运行收集、不依据观察改变关系结论。

`concord test run <case-id>` 重新收集并绑定当前原生集合；`--require-native` 要求精确原生选择。范围不足时可以在源码标记块添加 `@native <native-id>`；它不参与 v1 关联身份。无法精确绑定时执行范围为文件级 command；显式要求 native 时具名失败。

配置 `testAdapters` 按测试根内的路径段匹配且不得重叠。每项声明 `id`、`include`、`builtin` 或外部 `argv`、`implementationFiles`、`inputRoots`、`frameworkVersion`、`lockFiles` 与 `envNames`；超时和预算只可缩小硬上限。未覆盖的文件使用原 runner。

原生运行结果包含 requested、observed、Invocation 状态及输入摘要。green、red 与 invalid 表达逐项执行裁决；command scope 的 pass/fail 不表述为原生通过。缺少、重复、额外、skip、超时或清理未知均为 invalid，不能作为修复核验的任一端。能力与边界见[原生 adapter Use Case](use-case/run-native-test-adapters.md)。

`inputScope` 展示仓库内输入成员、摘要、排除项和框架/运行时版本。系统库、工具链、外部服务和包缓存无法冻结时，观察标记 `ExternalInputUnknown`、`complete=false`；仍可按完整 provider 收集范围授权精确 native 选择。运行结果保留环境 gap 和版本，`complete` 仅表示逐项报告完整。

### 超时与预算

`collectTimeoutMs`、`runTimeoutMs` 与 `wallTimeoutMs` 只能缩小默认上限 60000、300000 与 600000 毫秒。`budgets` 可缩小响应、输出、原生项、调用数及报告文件预算，不扩大[协议硬上限](#adapter-协议)。

### adapter 协议

外部 adapter 使用 `concord.test-adapter/v1`；每次请求启动一个受管子进程，stdin/stdout 各一个 JSON，stderr 只用于诊断。Concord 拥有原生 Invocation 的执行、状态裁决和报告目录。协议的 Schema 由库子路径 `concord-sdlc/test-adapter-protocol` 导出，见[库接口](library.md)。

`concord.test-adapter/v1` 的请求与响应都含 `format`、`op` 与 `requestId`，响应回显 `planId` 与 `inputs`；未知字段、重复键、非有限数与超限值拒绝，返回 `AdapterProtocolInvalid`。

| op | 输入 | 输出 |
| --- | --- | --- |
| `collect-plan` | 文件与成员摘要 | 非空 Invocation 列表与 `planContext` |
| `collect-parse` | 同一 context 与 `planContext`、全部调用状态、捕获输出与报告描述 | `cases`、`capabilities`、`completeness` |
| `select-plan` | 去重 nativeIds 与当前清单身份 | 非空 Invocation 列表及各自负责的 requested 子集 |
| `report-parse` | 同一计划、requested、状态与报告 | `observed`、`capabilities`、`completeness` |

- Invocation 含 `invocationId`、不经 shell 的非空 `argv`、仓库相对 `cwd`、取自配置白名单的 `envNames` 与 Concord 分配目录内的相对 `reports`；响应不能携带秘密值。Concord 回传每个调用的退出码、信号、超时、取消、截断与清理状态，parser 的成功响应不能覆盖它们。
- `capabilities` 分别声明真实收集、leaf 或参数组、精确选择、逐项报告、范围、标签与 skip 可见性，每项观察带 provenance。静态 AST 候选不能声明真实收集；范围缺失时不用单行位置伪造结束行。
- 原生项含 `nativeId`、`project`、`file`、`kind`（leaf 或 suite）、`group`、`range`、`selection` 与 `tags`。`nativeId` 含 provider 命名空间；range 为以 1 起计、两端包含的行号加源码摘要。同一 group 共享声明范围与 project。`complete` 为 false 时 `gaps` 非空；为 true 只表示 provider 声明的收集范围完整。
- 硬上限：响应 8 MiB，每调用 stdout 与 stderr 合计 16 MiB，原生项 100000，Invocation 128，报告文件 64 个、单个 8 MiB、合计 32 MiB。

`collect-plan` 之前取得 run 所有权，见[原生 adapter](architecture.md#原生-adapter)。

## 编辑器服务

编辑器以 `concord --root <worktree> lsp` 建立 stdio 会话。服务协商 UTF-16。同步方法包括 initialize/initialized、didOpen/didChange/didSave/didClose 与 publishDiagnostics。导航方法包括 definition、references、completion 与 hover，并支持取消与 shutdown/exit。stdout 只传递 Content-Length framed JSON-RPC。stderr 输出具名诊断。

打开缓冲区覆盖磁盘文本，多个未保存文档共同参与步骤、标记、引用与 writing v3 检查。新文件可只存在于内存；保存全文须与缓冲区相同，关闭清诊断，倒退或非法增量须关闭重开。删除保留未保存文本并标记输入不完整；重命名要求关闭旧 URI 后打开新 URI。客户端可发送 didChangeWatchedFiles、didDeleteFiles 与 didRenameFiles 通知依赖变化。

导航仅使用同版当前输入。过期请求返回 ContentModified（-32801），取消返回 RequestCancelled（-32800）；输入缺失发布 EditorInputsIncomplete。悬停明确说明未提供分析观察，不将缺失观察解释成没有关系。

服务只读，不提供 formatting、codeAction、executeCommand 或 willRenameFiles；未知编辑执行请求返回 EditorMethodNotSupported（-32601）。不启动 language server、collector 或 runner，不监听网络，不持久化 overlay。关闭、EOF 或 SIGINT 终结任务与句柄。预算与完整生命周期见[编辑器 Use Case](use-case/use-editor-service.md)。

## 观察与相关性

原生清单、依赖分析与相关性判定返回同一观察结构：`value`、`inputs`（全部实际输入的摘要，含实现与版本）、`complete`、`gaps`（`complete` 为 false 时的具名原因）、`observedAt` 与 `current`（输入摘要与当前源码一致）。

- 只有 `test discover`、`code analyze` 与 `test run` 的执行前收集产生观察；其它命令与编辑器服务只读取。
- 观察可丢弃。`check` 的退出码、finding 与 `complete` 不读取观察，冷缓存、热缓存、缓存损坏与清空后结论相同。
- `current` 为 false 的观察只作历史展示，带来源与时间，不用于选择执行或相关性判定。

相关性判定只报告观察到的正向交集，不输出“无关”结论：

| 结果 | 含义 |
| --- | --- |
| `observed` | 测试依赖中观察到声明实现目标的代码，带 `level`：`step`、`use-case` 或 `feature`；文件范围的结果同时带 `FileScope` |
| `not-observed` | 未观察到这样的代码，总带 `gaps`，例如 `FileScope`、`DepthLimit`、`NoSourceImports`、`SubprocessBoundary`、`NoAnalyzer`、`SnapshotNotCurrent` |

`not-observed` 不表示测试与 Spec 无关；CLI、review 与工作台写作“未观察到交集”并列出原因。只观察到其它 Feature 或同 Feature 另一 Use Case 的实现也不推出无关。判定不产生 finding，不改变退出码，关联与观察都不证明执行、断言正确或覆盖率，不用于修复核验。文件级 import 只能证明文件中的声明交集，不证明该文件每个 case 都调用了实现。

## 机器可读输出

agent 和脚本只依赖机器可读输出。

1. `--json` 输出结构、具名错误码与退出码是 agent 和脚本依赖的公开 Spec，由对应 Feature 的 CLI 页面或 Use Case 声明。
2. 删除或改变已声明字段、错误码与退出码含义属于破坏消费者兼容，须先经过[独立设计挑战](../../engineering/self-hosting/README.md#协作与授权)；新增字段不改变既有字段语义。
3. 人读输出不是 Spec，消费者不解析人读输出。
