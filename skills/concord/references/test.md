# 测试标记与执行

测试根默认是存在的 `test/`、`tests/`，源码根默认是存在的 `src/`，其它位置用 `concord.config.ts` 的 `testRoots`、`sourceRoots` 配置。`.env`、`.env.*` 与 `dist` 始终排除；vendor 或生成文件用 `sourceIgnore: ['src/generated', 'tests/vendor']` 排除。每项是仓库相对文件或目录（含子树），不支持 glob；显式来源根优先，文档、runner.sourceFiles 和直接读写仍严格校验。

Concord 从测试根里的 Concord 标记读取唯一正向关系，不解析宿主测试语法。标记存在即表示该测试关联存在。先让目标 Feature 或 Use Case 存在，再生成注释：

```sh
concord test marker --contract docs/feature/login/use-case/expired-token.md
```

把输出放进测试文件；`//`、`#` 和 `--` 都是标记。回归测试在同一标记块加 `@issue docs/issues/<id>.md`，指向它守护的 Issue，可重复。没有 `@name` 时运行覆盖整个文件，不声称选中了某个原生用例。示意：

```ts
// @use-case docs/feature/login/use-case/expired-token.md
// @issue docs/issues/expired-token-accepted.md
test('rejects expired tokens', () => {})
```

指向整个 Feature 时改用 `// @feature docs/feature/login/README.md`，每个测试只选择一个 Spec 目标。

测试标记指向能完整描述其断言的最小行为范围：一个 Use Case 步骤、行为页的标题 anchor，或整个 Use Case。跨多个步骤的端到端测试指向整个 Use Case，不拆成逐步骤标记。只验证内部不变量的测试可以指向 architecture 页的 anchor；使用者能观察到的保证，先写进行为页，再让测试指向那里。

Use Case 的根有序列表项可以在第一段末尾用 ` {#reject-token}` 声明步骤。ID 遵守文档名规则，保留 Unicode 拼写；它与本文件标题的显式 ID、slug 和连字符别名共用命名空间。代码、行内代码与 HTML 中的示例不声明步骤；无序或嵌套列表、其它文档 owner 不允许步骤标记。

测试使用 `// @use-case docs/feature/login/use-case/expired-token.md#reject-token` 关联该步骤，实现使用同一目标的 `@concord-implements`。整个 Use Case 和已有标题 anchor 的关联继续有效。查询和维护命令为：

```sh
concord use-case steps docs/feature/login/use-case/expired-token.md --json
concord use-case format docs/feature/login/use-case/expired-token.md --dry-run
concord use-case format docs/feature/login/use-case/expired-token.md --seed --list 1
concord use-case rename-step docs/feature/login/use-case/expired-token.md step-1 reject-token --dry-run
concord trace show docs/feature/login/use-case/expired-token.md --fresh
```

`steps` 列出列表 ordinal、范围、步骤及关联数。默认 `format` 只补齐已含 ID 的列表，保留已有 ID；`--seed --list` 显式选择一个未标记列表。自动分配的 `step-N` 跳过标题、其它步骤与旧引用占用的值。引用扫描不完整时拒绝补齐或改名。

`rename-step` 在一个 journal 中发布步骤标记、真实源码标记参数与 Markdown 链接的精确改写，代码示例不改。Memory 或 Issue 的 frontmatter 存在旧引用时返回 `ManagedReferenceBlocked`。中断后使用 `concord recover`；未知编辑保留现场。结果列出受影响测试关联：带 `@name` 的 ID 保持，未命名的 ID 随目标改变。

`steps`、`trace show` 与 `review` 区分步骤、整个 Use Case 与非步骤 anchor；未关联步骤和 `trace gaps` 的未标记列表提示不产生 finding，也不证明测试执行或覆盖率。没有分析器时，依赖交集只展示 `not-observed` 与 `NoAnalyzer`。

测试关联没有 `@concord-verifies` 标记。`@concord-implements` 声明实现归属，必须紧随 `@concord-file`、`@concord-code` 或 `@concord-begin`；不能用它代替测试关联。测试文件也可以显式声明实现归属，但只有测试根中的 `@feature` / `@use-case` 才建立测试关系。目标路径使用 owner 的实际文件名，中文名称与内部 ID 可以不同。

不要另建测试关系 JSON。Git 保存测试演进。缺值、一块标记上的重复 Spec、以及只有 `@issue` / `@status` / `@name` 的块会形成 finding；不认识的测试写法不是 finding。退役关系使用 `// @status retired`。先检查并发现 case：

```sh
concord check --json
concord test list --json
concord test show <derived-reference> --json
```

`test run` 执行项目 runner 或匹配的 adapter，返回本次结果。`test discover` 也会显式启动 adapter 和框架收集进程：

```sh
concord test run <derived-reference> --json
concord test verify <issue> --json
```

未配置 adapter 或无法精确绑定时，执行范围是整个作者声明的 command，不是底层 runner 的逐 case 原生结果。超时、信号、启动失败、已知零执行、全 skip/todo 或输出限制不是通过；通用 runner 的 unknown execution 也不能表述为 native case passed。

修复缺陷时先提交失败的回归测试，再提交只改产品文件的修复，然后运行 `issue close <id> --fixed`：它在两个提交上运行回归测试并把核验结论写进 Issue。`test verify <issue>` 按记录重放。完整流程与拒绝条件见 `concord --skill feedback`。


## 原生 adapter

在 `concord.config.ts` 声明 `testAdapters`。每项的 `include` 是 `testRoots` 内的文件或目录，按完整路径段匹配，不支持 glob；不同项的范围不得相交。未覆盖的文件保持原 runner 行为。

```ts
testAdapters: [{
  id: 'python',
  include: ['test/python'],
  builtin: 'pytest',
  frameworkVersion: '9.2.0',
  implementationFiles: [],
  inputRoots: ['fixtures'],
  lockFiles: ['uv.lock'],
  envNames: ['PATH', 'HOME', 'UV_CACHE_DIR'],
}]
```

内置名称为 `node-test`、`vitest`、`pytest`、`go`、`cargo`。固定框架版本必须与实际运行环境匹配；JVM 由外部 provider 提供。外部 adapter 用非空 `argv` 代替 `builtin`，并在 `implementationFiles` 列出执行脚本及其传递实现文件；`node adapter.ts` 不能只摘要 Node。`inputRoots` 应覆盖 fixture、导入支持文件和构建配置；锁文件由 `lockFiles` 声明。只把 `envNames` 中的环境变量传给进程，结果不记录环境值或原始计划参数。

```sh
concord test discover test/python/test_login.py --json
concord test list --json
concord test run <derived-reference> --require-native --json
```

`test list/show` 仅展示已有观察，带 `current`、`complete`、`gaps`；不会运行收集。`check`、`trace` 和关系身份不依赖观察缓存。run 始终重新收集当前目标，不使用旧清单作为选择依据。

仓库内输入在执行前后核对成员和字节；`inputScope` 展示纳入文件、摘要、排除项及版本。输入根覆盖测试、源码及声明的 fixture/配置目录；显式 `sourceIgnore` 子树属于排除项，不能把实际依赖排除后宣称完整。无法冻结的系统库、工具链、外部服务和包缓存以 `ExternalInputUnknown` 标记，观察的 `complete=false`。这项环境 gap 不阻止精确选择或逐项结果；结果保留 gap、配置框架版本、可读取的框架和运行时版本。结果的 `complete` 仅表示原生报告完整，不表示环境已冻结。

完整声明范围可以自动绑定标记和参数组。缺少范围时，在同一标记块添加 `@native <native-id>`，使用 collect 返回的带 provider 命名空间的 ID。它可以与 `@name` 共存，但不改变关联 ID。原生标签不创建关联；范围绑定与显式选择冲突时失败。没有精确绑定时执行范围为文件；`--require-native` 或无法满足的显式 `@native` 返回 `NativeSelectionUnsupported`。

Node 24 的独立原生收集能力未获验证时，返回 `NodeCollectionUnsupported`，不能声明原生选择。Go 的顶层列举不保证动态子测试完整；执行报告出现额外子项时 invalid。Cargo 内置入口限于明确 library root 或 integration-test target，按 target 拆分调用。缺少范围、参数组或标签能力时不推断这些元数据。

内置 Cargo 的模块化名称无法确定源码文件归属时，返回 `CargoFileMembershipUnknown`。报告目录安全读取当前依赖 Linux `/proc/self/fd`；其它平台返回 `ReportUnsafe`，不使用未经核验的路径读取替代。

外部程序使用 `concord.test-adapter/v1` 四种 op：`collect-plan`、`collect-parse`、`select-plan`、`report-parse`。每请求一个新进程，stdin/stdout 各一个 JSON；响应回显 format、op、requestId、planId 和 inputs。Concord 严格解码计划、状态与报告，拒绝未知字段、重复键、非有限数、越界路径与超预算报告。进程状态和清理由 Concord 裁决。

收集默认 60 秒、测试默认 300 秒、整个 run 默认 600 秒；`collectTimeoutMs`、`runTimeoutMs`、`wallTimeoutMs` 与 `budgets` 只可缩小硬上限。超时、取消、截断、输入漂移和清理未知不能被成功 JSON 覆盖。清理未知会保留 runner 阻断现场。

原生结果记录非空 requested、逐项 observed、Invocation 状态和分配、输入与计划摘要。每项恰好一次 passed、命令退出 0、清理完成才是通过；完整结果至少一项 failed 且命令非零退出才是失败。缺失、重复、额外、skip/todo、解析和基础设施失败为 invalid。
