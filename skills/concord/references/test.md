# 测试注释与命令证据


源码与测试自动发现支持在 `concord.config.ts` 设置 `sourceIgnore: ['src/generated', 'tests/vendor']`。每项是仓库相对文件或目录（含子树），不支持 glob；显式来源根优先，文档、runner.sourceFiles 和直接读写仍严格校验。
Concord 从测试根里的 Concord 标记读取唯一正向关系，不解析宿主测试语法。标记存在即表示该测试关联存在。先让目标 Feature 或 Use Case 存在，再生成注释：

```sh
concord test annotate --contract docs/feature/login/use-case/expired-token.md --regression memory/expired-token-accepted.md
```

把输出放进测试文件；`//`、`#` 和 `--` 都是标记。可重复 `--regression`。没有 `@name` 时运行覆盖整个文件，不声称选中了某个原生用例。示意：

```ts
// @use-case docs/feature/login/use-case/expired-token.md
// @regression memory/expired-token-accepted.md
test('rejects expired tokens', () => {})
```

指向整个 Feature 时改用 `// @feature docs/feature/login/README.md`，每个测试只选择一个契约目标。

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

`rename-step` 在一个 journal 中发布步骤标记、真实源码标记参数与 Markdown 链接的精确改写，代码示例不改。受管 Memory、Issue 或 Design 元数据存在旧引用时返回 `ManagedReferenceBlocked`。中断后使用 `concord recover`；未知编辑保留现场。结果列出受影响测试关联：带 `@name` 的 ID 保持，未命名的 ID 随目标改变，两者的旧收据均不能复用。

`steps`、`trace show` 与 `review render` 区分步骤、整个 Use Case 与非步骤 anchor；未关联步骤和 `trace gaps` 的未标记列表提示不产生 finding，也不证明测试执行或覆盖率。没有分析器时，依赖交集只展示 `not-observed` 与 `NoAnalyzer`。

测试关联没有 `@concord-verifies` 标记。`@concord-implements` 声明实现归属，必须紧随 `@concord-file`、`@concord-code` 或 `@concord-begin`；不能用它代替测试关联。测试文件也可以显式声明实现归属，但只有测试根中的 `@feature` / `@use-case` 才建立测试关系。目标路径使用 owner 的实际文件名，中文名称与内部 ID 可以不同。

不要另建测试关系 JSON。Git 保存测试演进。缺值、一块标记上的重复契约、以及只有 `@regression` / `@status` / `@name` 的块会形成 finding；不认识的测试写法不是 finding。退役关系使用 `// @status retired`。Repository profile 的注释解析是另一套规则，不由本页的 CLI 扫描代替。先检查并发现 case：

```sh
concord check --json
concord test list --json
concord test show <derived-reference> --json
```

只有 `test run` 会执行项目 runner：

```sh
concord test run <derived-reference> --json
concord test evidence ccev_REPLACE_WITH_ID --json
```

收据的 evidence scope 是整个作者声明 command，不是底层 runner 的逐 case 原生覆盖证明。超时、信号、启动失败、已知零执行、全 skip/todo 或输出限制不能作为 fixed 的正常 green；通用 runner 的 unknown execution 也不能表述为 native case passed。

修复 Problem 时先取得正常非零退出的 red，保持测试定义与契约不变，只修产品实现，再取得成功且清理完成的 green。候选、完整测试文件、runner 配置、声明的 sourceFiles 或契约变化都会使证据陈旧。不要手写或导入收据。
