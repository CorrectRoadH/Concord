# 测试标记与原生收集

测试根默认是存在的 `test/`、`tests/`，源码根默认是存在的 `src/`，其它位置用 `concord.config.ts` 的 `testRoots`、`sourceRoots` 配置。`.env`、`.env.*` 与 `dist` 始终排除；vendor 或生成文件用 `sourceIgnore: ['src/generated', 'tests/vendor']` 排除。每项是仓库相对文件或目录（含子树），不支持 glob；显式来源根优先，文档和直接读写仍严格校验。

Concord 从测试根里的 Concord 标记读取唯一正向关系，不解析宿主测试语法。标记存在即表示该测试关联存在。先让目标 Feature 或 Use Case 存在，再生成注释：

```sh
concord test marker --contract docs/feature/login/use-case/expired-token.md
```

把输出放进测试文件；`//`、`#` 和 `--` 都是标记。回归测试在同一标记块加 `@issue docs/issues/<id>.md`，指向它守护的 Issue，可重复。`@name` 提供稳定关联身份，不是执行选择器。示意：

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

## 原生测试收集

按需在 `concord.config.ts` 声明 `testAdapters`。每项声明 `id`、位于测试根内且互不重叠的 `include`，以及 `builtin` 或外部 `argv`。未覆盖的文件仍保留静态标记能力。

```sh
concord test discover --json
concord test show <derived-reference> --json
concord trace gaps --json
```

收集返回框架认识的具体用例、原生身份、参数组、范围与 label（`tags`），能力不足则返回 gap。`test list/show` 的 `bindings` 在 Concord 内派生当前标记对应的原生用例，提供其 label 与位置；消费者不自行重写绑定算法。

有真实范围时自动绑定；没有范围时可以在同一标记块写 `@native <收集返回的完整nativeId>`。原生 ID 或 label 不替代 Spec 关系，不改变关联 ID。参数组按真实 group 与范围识别，不能按同名或 label 合并。

外部 adapter 使用 `concord.test-adapter/v1` 的 `collect-plan` 与 `collect-parse`。每请求一个新进程，stdin/stdout 各一个 JSON；响应回显 format、op、requestId、planId 与 inputs。通过 `concord schema test-adapter` 读取完整字段和预算。

收集可以加载项目模块或编译列举，但不派发测试体，也不以执行测试补齐清单。加载模块可能有副作用，必须信任项目和收集工具。Concord 管理自己的收集进程、输出与产物目录；超时、取消、截断、输入漂移或清理未知都不能成为成功清单。

普通查询与 `concord check` 不启动收集；缺少或过期观察如实展示，不影响静态关系或 Issue 关闭。收集、label 和绑定不证明测试执行、通过或覆盖率。

## 运行与验证

coding agent 依项目的 AGENTS、Engineering 和 CI 约定，直接选择并运行测试，处理环境、超时与清理，报告实际命令、范围、结果和未验证项。Concord 不提供测试执行、红绿核验或结果裁决，不要求拆分提交，也不重复执行以关闭 Issue。

缺陷修复见 `concord --skill fix`；Issue 的引用清理与关闭见 `concord --skill feedback`。
