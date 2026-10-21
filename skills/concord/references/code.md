# Code declarations


源码与测试自动发现支持在 `concord.config.ts` 设置 `sourceIgnore: ['src/generated', 'tests/vendor']`。每项是仓库相对文件或目录（含子树），不支持 glob；显式来源根优先，文档、runner.sourceFiles 和直接读写仍严格校验。
代码声明描述实现与 Feature / Use Case / Engineering 的关联。它既不是测试声明，也不是完成或覆盖证明。真实注释是唯一 owner；无需另写关系 JSON。

先读取 `concord.config.ts`。`sourceRoots` 是可选的仓库相对路径数组，缺省 `[]`；默认扫描其中 JS/TS 文件；配置 languageServers 后也扫描相应后缀的文本标记。JS/TS 支持，包括 `.js/.jsx/.ts/.tsx/.mjs/.cjs/.mts/.cts`。新项目可用 `concord init --source-root src`，该选项可重复并可与 `--docs-only` 组合。已有项目直接维护配置，不重复 init。`testRoots` 与 `sourceRoots` 可重叠，各标签属于自己的扫描器；`doctor` 提示缺失目录。

## 声明与查询

```sh
concord code annotate --scope node \
  --contract docs/feature/orders/use-case/create-order.md
concord code list --json
concord code locate src/orders.ts --line 12 --json
concord trace show orders --json
concord review render orders
concord check
```

`annotate` 只生成经验证的片段，不编辑源文件，不接收或返回声明 ID。范围标记不带参数，`@concord-implements` 保留显式契约关联。多契约重复 `--contract`，或添加多条相邻 implements；重复 exactRef 拒绝。目标使用 canonical Feature / Use Case / Engineering 路径，也支持 Feature 或 Engineering supporting page 与有效 `#anchor`。不同 anchor 保留独立关联。

```ts
// @concord-file
// @concord-implements docs/feature/orders/README.md

// @concord-code
// @concord-implements docs/feature/orders/use-case/create-order.md
export function parseOrder(input: string) {
  // @concord-begin
  // @concord-implements docs/feature/orders/README.md
  const normalized = input.trim();
  const result = normalized.toLowerCase();
  // @concord-end
  return result;
}
```

## 作用域与边界

- `file`：在首个语句之前，允许前置 BOM、shebang 和许可证注释。每文件最多一份，范围为整个文件。
- `node`：紧邻有函数体的函数声明、类声明、有函数体的方法（含对象方法），或仅绑定一个标识符且 initializer 直接为 arrow/function 的变量语句。包含 export / decorator。签名、重载签名、解构、多变量、匿名回调及任意表达式不支持；用完整语句的 region 表达其它代码段。
- `region`：无参数的 begin / end 成对包住同一语句列表中连续、非空的完整语句，可以包含完整函数；不能嵌套 region、跨函数边界或截断表达式。

每节点最多一份声明。file、node 和 region 可以完整包含；没有覆盖、继承或优先级规则。`locate` 使用 1-based 行号，返回所有包含该行的显式作用域；node/region 范围从实际代码首行到末行，含两端，排除外围标记行。同行其它表达式不作列级区分。

仅使用独占一行的 `//` 标记。起始标记之后的 implements 必须连续且相邻，不能跨空行、其它 family 标签或注释寻找目标。目标之后可以有普通注释或空白，但不能跨另一代码标记或代码 token 绑定到更远节点。字符串、模板、正则、JSX 文本中的类似文字不会注册声明。

## 校验与修正

`code`、`check`、`trace`、`review` 和 `doctor` 校验代码声明及引用；标注文件存在语法错误时不会信任恢复后的 AST。未知 `@concord-*` 在 sourceRoots 中报错，已知测试及 repository profile 标签交给原有 owner。

代码关系每次从当前 Markdown 重算，并核对文件集合与摘要。声明解析可命中 Git-private 的可重建投影（普通 checkout 通常为 `.git/concord/cache.hawdb`，用 `concord cache status` 查询实际位置）；字节摘要变化、损坏或 `cache clear` 后回源。清缓存不能修复源码错误。

## 自动查询引用

`list` 和图中的 `id` 是工具内部使用的 `code-…` 自动引用，来自版本、仓库相对源路径、scope 和 AST 结构位置；不写入源码或第二份登记表。按文件与行号使用 `locate` 查询声明；Web 直接显示符号、文件位置和关联契约。

定位路径及同描述前序兄弟不变时，空白、行号、普通函数体与 implements 修改不改变 node 引用。同内容新进程或 clone 可重新得到相同引用。文件移动、改名、改变作用域，以及同描述兄弟或 region 次序变化可能改变引用；旧引用也可能成功指向另一声明，例如删除前方 region 标记后后方 region 接续其序号。

引用只服务于当前扫描，不是永久历史身份、CAS token 或授权。自动消费者应重新 list/locate 并核对文件、符号和范围，不能凭旧引用的查询成功认定历史连续。移动或复制实现后重新查询即可，不需要命名新 ID。

合法配置下，代码标注错误不会阻断 `test list/show/run` 或 `memory resolve`；这些命令继续执行原有文档、测试及证据校验。代码声明不能替代测试、red/green 收据或 Problem fixed 证明。


## 多语言标记与显式分析

非 JS/TS 声明使用 languageServers profile 的注释前缀，沿用 file、code、begin/end 与紧邻的 implements 标记。身份由 canonical 文件路径与标记块序号派生。文件声明定位到文件，region 定位到配对标记；code 没有当前符号观察时定位到标记行。

`concord code analyze --json` 是唯一显式 LSP 分析入口，不接受 dry-run。JS/TS 测试使用内置 TypeScript 模块解析，静态命令、test run 与编辑器服务均不隐式启动 server。观察存于 HawDB，不能创建关联、签发证据或影响 check。

配置每个 server 的 id、languageId、extensions、argv、cwd、initializationOptions、implementationFiles、sourceFiles、profile 与 budgets。cwd 为仓库内目录，`.` 为根。implementationFiles 必须包含实际入口、脚本、插件与依赖锁；不要只声明 node 等启动器。扩展后缀唯一且不重叠，不接受 JS/TS 扩展。typescript 是内置分析器的保留 ID。

声明式 profile 包含 version、serverVersion、commentPrefixes、declarationKinds、symbolShape、decorators、leadingComments、readiness 与 positionEncodings。commentPrefixes 只选 `#`、`//`、`--`、`;`；symbolShape 为 document-symbol，decorators 为 none 或 at-line。readiness 为 `{ kind: 'none' }` 或 `{ kind: 'progress', token: 'index' }`；positionEncodings 选 utf-16、utf-8、utf-32。

server 必须在 initialize 的 serverInfo.version 确认固定版本。只接受层级 documentSymbol；扁平、null、非法范围和歧义保留 UnsupportedSymbolBinding，不从 selectionRange 假造完整范围。无可验证就绪信号时保留 IndexReadinessUnknown。

budgets 接受 totalMs、requestMs、outputBytes、messageBytes、messages、requests、concurrency、files、symbols、nodes、depth。深度默认 3，其它默认值为包级上限；数值为正整数且不得突破固定上限。请求串行执行，遵守配置的并发上限。

environment 只显式选择 PATH、LANG、LC_ALL、TZ、TMPDIR、SYSTEMROOT，不传递其它环境或凭据。server 是消费者信任的程序；拒绝 applyEdit 和执行请求不能阻止它自行写文件。输入改变返回 AnalysisSourceChanged，清理未知保留 runner 阻断。

code list、trace show --fresh、test show 的 analysis 返回 observations 与 relevance。观察保留 inputs、observedAt、current、complete、gaps、分析器/profile 与可选 locator。没有目标交集时显示“未观察到交集”，历史观察不能用于当前判定。

文件级依赖始终标 FileScope，不把文件中另一 case 的导入称为当前 case 的调用证明。调用观察始终标 OpenWorldCalls；LSP 无法核验的动态派发、子进程与协议边界分别标 UnknownDynamicDispatch、UnknownSubprocessBoundary 与 UnknownProtocolBoundary。动态 import、未解析模块、外部目标、网络、子进程与预算截断分别记录缺口。没有观察到交集不产生 finding 或失败退出码。current 表达仓库内输入一致性；复核通过的 LSP 观察可用于符号定位与 observed 判定。未核验的外部 SDK、环境与私有索引保留 UnverifiedEnvironment，complete 为 false。

具体语言、server 与 profile 的兼容承诺须有固定版本的真实 fixture。标记关系和协议 fake 不能替代真实 Python、Go、Rust 或 Java server 兼容证据。

## 编辑器服务

编辑器启动 `concord --root <worktree> lsp`，用 Content-Length framed JSON-RPC 连接 stdio，协商 UTF-16。支持文档打开、递增版本修改、保存、关闭，推送带版本的诊断，并提供 definition、references、completion 与 hover。多个未保存缓冲区共同参与步骤、源码标记、引用和写作检查；合法新文件可只存在于内存。

保存不以磁盘覆盖客户端文本，携全文时必须一致。非法增量、版本倒退、重复打开和保存冲突须关闭重开；旧请求返回 ContentModified（-32801），取消返回 RequestCancelled（-32800）。删除保留打开文本并标记不完整；didRenameFiles 不迁移 overlay，须关闭旧 URI 并打开新 URI。文件变化可通过 didChangeWatchedFiles、didDeleteFiles 和 didRenameFiles 通知。

只接受当前 worktree 的安全 file URI，拒绝符号链接、路径逃逸与私有目录。配置授权使用已保存配置，每次计算复核配置、磁盘和缓冲区代次；输入缺失显示 EditorInputsIncomplete，不表示项目全部通过。服务不提供分析观察，不能据此推断没有关系或执行覆盖。

服务不注册编辑、格式化、codeAction、executeCommand 或 willRenameFiles，不启动分析进程、测试 collector 或 runner，不开网络端口，不持久化缓冲区。未知编辑执行请求拒绝；shutdown/exit、EOF 与 SIGINT 释放任务和句柄。具体预算与客户端生命周期见随包 docs/feature/local-sdlc/use-case/use-editor-service.md。
