# 命令体验

本页按日常顺序列出命令、实际输出、退出码与错误。示例来自一个只有 `src/cart.js` 与 `test/cart.test.js` 的消费仓库。摘要和时间戳因运行而异，其余字段与真实输出一致。实现方式见[架构](architecture.md)。

## 通用约定

- 每个命令都接受 `--json`。Agent 与脚本读取 JSON，不解析人读输出。JSON 字段是公开契约。
- 退出码 0 表示成功。退出码 1 表示命令拒绝执行、检查发现问题或测试失败。
- 命令拒绝执行时，错误对象写到 stderr，形如 `{"ok":false,"error":"<错误码>","message":"...","details":{...}}`。`details` 可省略。人读输出以 `ok: false`、`error:`、`message:` 三行开头。`check` 这类检查命令发现问题时，结果仍写到 stdout，`ok` 为 false。
- `--root <worktree>` 指定消费仓库。省略时从 cwd 向上查找 `concord.config.ts`。
- `--dry-run` 放在子命令之前，校验并预览写入，不改文件。人读输出以 `Would apply` 开头。
- 诊断类读取默认返回后台刷新的快照。尚无快照时返回 `QueryPending`，`details.refresh` 为 `requested`。加 `--fresh` 等待当前来源。

## 接入

`concord --skill` 输出 Agent 入口：主题列表、设计理由与工作原则。`concord --skill <topic>` 输出一个主题，`concord --skill all` 输出全部主题。这个入口在任意 cwd 可用，不读取项目，也不写文件。未知主题返回 `SkillTopicUnknown`。

`concord init` 在 Git worktree 顶层初始化项目，人读输出列出创建的文件，最后给出下一步：

```text
  docs/README.md
  docs/concepts.json
  docs/concord-writing.json
  ...
  memory/README.md
  AGENTS.md

Start here: docs/concord.md
Next: concord feature create <id> --title "Your feature"
Inspect configuration: concord doctor
```

`concord doctor --json` 报告配置与接入缺口，不运行测试：

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
  "findings": [{"code": "ConstitutionDraft", "path": "docs/constitution.md", "message": "The project constitution is structurally valid but still draft; adopt real principles explicitly."}],
  "nextSteps": ["Adopt real project principles with concord constitution adopt; draft is not compliance.", "Run concord check to validate all relations.", "Run concord test run <id> to record command evidence."]
}
```

`concord template list/show` 在未初始化的目录也能读取随包模板。

## 创建契约

`feature`、`use-case`、`roadmap`、`design`、`engineering` 与 `research` 各有 `create`、`list`、`show`。省略 `--body` 时使用模板正文，`--body <file>` 或 `--body -` 提交完整正文。

```sh
concord feature create cart --title "购物车" --pages cli,use-case
```

```text
Applied create-feature:
  docs/feature/cart/README.md
  docs/feature/cart/cli.md
  docs/feature/cart/use-case/README.md

Next: edit the author prose, then run concord check.
```

```sh
concord --json use-case create add-item --feature cart --title "加入商品"
```

```json
{"operation":"create-use-case","dryRun":false,"changedPaths":["docs/feature/cart/use-case/add-item.md"]}
```

ID 已存在时返回 `DocumentExists`，退出 1，不改文件。

修改正文用 `author set <path> --body <file> --expected-digest <digest>`，附页用 `<kind> page show/set`。digest 取自 `show --json` 或 `page show --json` 的 `digest` 字段。文件在读取后被改过时返回 `PreimageChanged`，需要重新读取并合并。

## 关联源码

`code annotate` 与 `test annotate` 只把校验过的标记写到 stdout，不改源码。引用的契约不存在时返回 `ReferenceNotFound`。

```sh
concord code annotate --scope file --contract docs/feature/cart/README.md
```

```text
// @concord-file
// @concord-implements docs/feature/cart/README.md
```

`--scope node` 关联标记下方的一个声明，`--scope region` 关联一段代码。实现源码根由 `concord.config.ts` 的 `sourceRoots` 配置，`init --source-root src` 可在初始化时设置。

```sh
concord test annotate --contract docs/feature/cart/use-case/add-item.md --regression memory/duplicate-sku.md
```

```text
// @use-case docs/feature/cart/use-case/add-item.md
// @regression memory/duplicate-sku.md
```

`--json` 返回 `{"operation":"test-annotate","snippet":"..."}`。`code list` 返回当前代码声明，`code locate <path> --line <n>` 返回包含该行的全部声明。代码声明只表示实现关联，不代替测试，也不证明契约已完成。完整语法见 `concord --skill code`。

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
  docs/constitution.md
    ConstitutionDraft: The project constitution is structurally valid but still draft; adopt real principles explicitly.
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

`ok` 为 false 表示发现违规。`complete` 为 false 表示有必需输入没能读取，结论不完整。`advisories` 是提示，不影响退出码。已关闭 Problem 的收据列在 `memoryEvidence`，附 `"note":"Historical command evidence; not current verification."`。

## 追踪关系

`concord trace show --fresh <path>` 返回一份契约的正文、关系、测试与代码声明。不加 `--fresh` 且尚无快照时返回 `QueryPending`。`--json` 的顶层字段为 `operation`、`subject`、`relatedPaths`、`incoming`、`outgoing`、`tests`、`codeDeclarations`、`stepGroups`、`cache` 与 `analysis`：

```json
{
  "operation": "trace-show",
  "subject": {"path": "docs/feature/cart/use-case/add-item.md", "metadata": {"kind": "use-case", "feature": "docs/feature/cart/README.md"}, "digest": "sha256:..."},
  "incoming": [{"from": "case:neref_854212737ecad7effc4666629752cb98", "to": "docs/feature/cart/use-case/add-item.md", "relation": "contract"}],
  "outgoing": [{"from": "docs/feature/cart/use-case/add-item.md", "to": "docs/feature/cart/README.md", "relation": "feature"}],
  "tests": [{"id": "neref_854212737ecad7effc4666629752cb98", "file": "test/cart.test.js", "line": 5, "contract": "docs/feature/cart/use-case/add-item.md", "regressions": ["memory/duplicate-sku.md"], "status": "active"}],
  "codeDeclarations": [],
  "analysis": {"observations": [], "relevance": [{"testId": "neref_854212737ecad7effc4666629752cb98", "scope": "file", "relevance": {"verdict": "not-observed", "gaps": ["NoAnalyzer"]}, "message": "未观察到交集"}]}
}
```

`codeDeclarations` 为空表示没有代码直接声明实现这个 Use Case。示例中的代码声明指向 Feature README，在 Feature 的 `trace show` 中列出。`trace gaps --json` 列出缺少实现或测试关联的契约。`trace check` 只做关系检查。`review render` 生成审阅材料。这些命令都不运行测试。

## 测试与证据

`concord --json test list` 列出测试根中的标记。`cases[].id` 是 `test run` 使用的 case ID：

```json
{"operation":"test-list","cases":[{"id":"neref_854212737ecad7effc4666629752cb98","file":"test/cart.test.js","line":5,"contract":"docs/feature/cart/use-case/add-item.md","contractKind":"use-case","regressions":[],"status":"active","framework":"marker","skipped":false}],"observations":[]}
```

`concord test run <case-id>` 用配置的 runner 运行 case 所在文件，argv 不经过 shell，并保存一份收据。人读输出：

```text
Command fail — neref_854212737ecad7effc4666629752cb98
Receipt: ccev_c5131e3e563df91019790cf68acabbae
Scope: command (does not prove native case coverage)
Execution: nonzero; exit: 1; cleanup: true
Timeout: false; cancelled: false; signal: null
Arguments: ["node","--test","--test-reporter=tap","test/cart.test.js"]
```

测试通过时首行为 `Command pass`，退出 0；测试失败时退出 1，收据照常保存。`--json` 输出完整收据，格式为 `concord.command-evidence/v1`。`commandOutcome` 取 `pass`、`fail` 或 `invalid`。`execution` 取 `nonzero`、`zero`、`skipped` 或 `unknown`，分别表示执行的测试数大于 0、等于 0、全部跳过或无法判断。

`memory resolve <id> --kind fixed --red <receipt> --green <receipt> --reason <text>` 用两份收据关闭 Problem。完整路径、输出与错误码见[记录命令证据并关闭 Problem](use-case/resolve-with-command-evidence.md)。

## 缓存与恢复

`cache status/clear/rebuild` 只管理可删除的缓存。`cache rebuild` 在缓存目录缺失时创建它，重建后仍不可读时返回 `CacheRebuildUnavailable`，成功的 JSON 结果附 `cacheStatus`。缓存不可用时，命令从源文件重新计算，结论不变。

`recover` 完成或回退中断的写入。现场内容与计划不符时拒绝覆盖，保留文件。

## 读取错误

- 读取过的文件在同一次命令内被按大小写改名时，命令结束时返回 `PreimageChanged`，`details` 为 `source-observation`。
- 非普通文件在读取或扫描时返回 `InvalidFile`，在核验阶段返回 `UnsafePath`。symlink 与越出仓库的路径在任何阶段都返回 `UnsafePath`。
- macOS 低于 11 时返回 `UnsupportedHost`。
- 固定版本的 TypeScript 原生编译器不可用时，相关解析返回 `TypeScriptUnavailable`。编译器作用域违反同步生命周期约束时返回 `TypeScriptScopeViolation`。

路径检查的规则见[读取路径安全检查的成本边界](../../design/path-safety-cost/plans/anchored-root/architecture.md)。

## 依赖分析

`code analyze` 显式生成可丢弃依赖观察；不接受 `--dry-run`，不签发测试收据。JS/TS 使用内置 TypeScript 模块解析，不启动 server。其它语言根据 `languageServers` 配置启动受管 LSP 进程，具体配置见[多语言分析](use-case/analyze-other-languages.md)。

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

`concord test collect [<file>...]` 显式运行配置的 adapter，保存可丢弃的原生清单观察。`test list/show` 只读展示 `current`、`complete` 与 `gaps`；`check` 与 `trace` 不运行收集、不依据观察改变关系结论。

`concord test run <case-id>` 重新收集并绑定当前原生集合；`--require-native` 要求精确原生选择。范围不足时可以在源码标记块添加 `@native <native-id>`；它不参与 v1 关联身份。无法精确绑定时执行范围为文件级 command；显式要求 native 时具名失败。

配置 `testAdapters` 按测试根内的路径段匹配且不得重叠。每项声明 `id`、`include`、`builtin` 或外部 `argv`、`implementationFiles`、`inputRoots`、`frameworkVersion`、`lockFiles` 与 `envNames`；超时和预算只可缩小硬上限。未覆盖的文件使用原 runner。

原生收据为 `concord.native-evidence/v2`，包含 requested、observed、Invocation 状态及输入摘要。green、red 与 invalid 表达逐项执行裁决；command scope 的 pass/fail 不表述为原生通过。缺少、重复、额外、skip、超时或清理未知均不能用于 fixed。能力与边界见[原生 adapter Use Case](use-case/run-native-test-adapters.md)。

`inputScope` 展示仓库内输入成员、摘要、排除项和框架/运行时版本。系统库、工具链、外部服务和包缓存无法冻结时，观察标记 `ExternalInputUnknown`、`complete=false`；仍可按完整 provider 收集范围授权精确 native 选择。原生收据保留环境 gap 和版本，`complete` 仅表示逐项报告完整，不能满足 repository profile 的原生可靠性等级。

## 编辑器服务

编辑器以 `concord --root <worktree> lsp` 建立 stdio 会话。服务协商 UTF-16。同步方法包括 initialize/initialized、didOpen/didChange/didSave/didClose 与 publishDiagnostics。导航方法包括 definition、references、completion 与 hover，并支持取消与 shutdown/exit。stdout 只传递 Content-Length framed JSON-RPC。stderr 输出具名诊断。

打开缓冲区覆盖磁盘文本，多个未保存文档共同参与步骤、标记、引用与 writing v3 检查。新文件可只存在于内存；保存全文须与缓冲区相同，关闭清诊断，倒退或非法增量须关闭重开。删除保留未保存文本并标记输入不完整；重命名要求关闭旧 URI 后打开新 URI。客户端可发送 didChangeWatchedFiles、didDeleteFiles 与 didRenameFiles 通知依赖变化。

导航仅使用同版当前输入。过期请求返回 ContentModified（-32801），取消返回 RequestCancelled（-32800）；输入缺失发布 EditorInputsIncomplete。悬停明确说明未提供分析观察，不将缺失观察解释成没有关系。

服务只读，不提供 formatting、codeAction、executeCommand 或 willRenameFiles；未知编辑执行请求返回 EditorMethodNotSupported（-32601）。不启动 language server、collector 或 runner，不监听网络，不持久化 overlay。关闭、EOF 或 SIGINT 终结任务与句柄。预算与完整生命周期见[编辑器 Use Case](use-case/use-editor-service.md)。

## 中立高级治理

消费仓库通过锁定的 `concord repo` 入口加载自己的 host。`docs test` 的 current 关系写在真实声明上方，native inventory 校验 ID/path；history/tombstone 保存在注释归档。正式 v2 red/takeover 由 host 执行并签发，已有回归使用显式 `regression refresh --reason` 更新陈旧证据。此入口的 formal gate 不接受通用 command receipts。
