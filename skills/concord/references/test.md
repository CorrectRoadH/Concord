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

测试关联没有 `@concord-verifies` 标记。`@concord-implements` 声明实现归属，必须紧随 `@concord-file`、`@concord-code` 或 `@concord-begin`；不能用它代替测试关联。测试文件也可以显式声明实现归属，但只有测试根中的 `@feature` / `@use-case` 才建立测试关系。目标路径使用 owner 的实际文件名，中文名称与内部 ID 可以不同。

不要另建测试关系 JSON。Git 保存测试演进。缺值、一块标记上的重复契约、以及只有 `@regression` / `@status` / `@name` 的块会形成 finding；不认识的测试写法不是 finding。退役关系使用 `// @status retired`。Repository profile 的注释解析是另一套规则，不由本页的 CLI 扫描代替。先检查并发现 case：

```sh
concord check --json
concord test list --json
concord test show <derived-reference> --json
```

`test run` 执行项目 runner 或匹配的 adapter。`test collect` 也会显式启动 adapter 和框架收集进程：

```sh
concord test run <derived-reference> --json
concord test evidence ccev_REPLACE_WITH_ID --json
```

未配置 adapter 或无法精确绑定时，收据的 evidence scope 是整个作者声明 command，不是底层 runner 的逐 case 原生覆盖证明。超时、信号、启动失败、已知零执行、全 skip/todo 或输出限制不能作为 fixed 的正常 green；通用 runner 的 unknown execution 也不能表述为 native case passed。

修复 Problem 时先取得正常非零退出的 red，保持测试定义与契约不变，只修产品实现，再取得成功且清理完成的 green。候选、完整测试文件、runner 配置、声明的 sourceFiles 或契约变化都会使证据陈旧。不要手写或导入收据。


## 原生 adapter

在 `concord.config.ts` 声明 `testAdapters`。每项的 `include` 是 `testRoots` 内的文件或目录，按完整路径段匹配，不支持 glob；不同项的范围不得相交。未覆盖的文件保持原 runner 行为。

```ts
testAdapters: [{
  id: 'python',
  include: ['test/python'],
  builtin: 'pytest',
  frameworkVersion: '9.1.1',
  implementationFiles: [],
  inputRoots: ['fixtures'],
  lockFiles: ['uv.lock'],
  envNames: ['PATH', 'HOME', 'UV_CACHE_DIR'],
}]
```

内置名称为 `node-test`、`vitest`、`pytest`、`go`、`cargo`。固定框架版本必须与实际运行环境匹配；JVM 由外部 provider 提供。外部 adapter 用非空 `argv` 代替 `builtin`，并在 `implementationFiles` 列出执行脚本及其传递实现文件；`node adapter.ts` 不能只摘要 Node。`inputRoots` 应覆盖 fixture、导入支持文件和构建配置；锁文件由 `lockFiles` 声明。只把 `envNames` 中的环境变量传给进程，收据不记录环境值或原始计划参数。

```sh
concord test collect test/python/test_login.py --json
concord test list --json
concord test run <derived-reference> --require-native --json
```

`test list/show` 仅展示已有观察，带 `current`、`complete`、`gaps`；不会运行收集。`check`、`trace` 和关系身份不依赖观察缓存。run 始终重新收集当前目标，不使用旧清单作为选择依据。

仓库内输入在执行前后核对成员和字节；`inputScope` 展示纳入文件、摘要、排除项及版本。输入根覆盖测试、源码及声明的 fixture/配置目录；显式 `sourceIgnore` 子树属于排除项，不能把实际依赖排除后宣称完整。无法冻结的系统库、工具链、外部服务和包缓存以 `ExternalInputUnknown` 标记，观察的 `complete=false`。这项环境 gap 不阻止精确选择或逐项收据；收据保留 gap、配置框架版本、可读取的框架和运行时版本。收据的 `complete` 仅表示原生报告完整，不表示环境已冻结，也不能用于证明 repository profile 的原生可靠性等级。

完整声明范围可以自动绑定标记和参数组。缺少范围时，在同一标记块添加 `@native <native-id>`，使用 collect 返回的带 provider 命名空间的 ID。它可以与 `@name` 共存，但不改变 v1 关联 ID。原生标签不创建关联；范围绑定与显式选择冲突时失败。没有精确绑定时执行范围为文件；`--require-native` 或无法满足的显式 `@native` 返回 `NativeSelectionUnsupported`。

Node 24 的独立原生收集能力未获验证时，返回 `NodeCollectionUnsupported`，不能声明原生选择。Go 的顶层列举不保证动态子测试完整；执行报告出现额外子项时 invalid。Cargo 内置入口限于明确 library root 或 integration-test target，按 target 拆分调用。缺少范围、参数组或标签能力时不推断这些元数据。

内置 Cargo 的模块化名称无法确定源码文件归属时，返回 `CargoFileMembershipUnknown`。报告目录安全读取当前依赖 Linux `/proc/self/fd`；其它平台返回 `ReportUnsafe`，不使用未经核验的路径读取替代。

外部程序使用 `concord.test-adapter/v1` 四种 op：`collect-plan`、`collect-parse`、`select-plan`、`report-parse`。每请求一个新进程，stdin/stdout 各一个 JSON；响应回显 format、op、requestId、planId 和 inputs。Concord 严格解码计划、状态与报告，拒绝未知字段、重复键、非有限数、越界路径与超预算报告。进程状态和清理由 Concord 裁决。

收集默认 60 秒、测试默认 300 秒、整个 run 默认 600 秒；`collectTimeoutMs`、`runTimeoutMs`、`wallTimeoutMs` 与 `budgets` 只可缩小硬上限。超时、取消、截断、输入漂移和清理未知不能被成功 JSON 覆盖。清理未知会保留 runner 阻断现场。

原生收据格式为 `concord.native-evidence/v2`，记录非空 requested、逐项 observed、Invocation 状态和分配、输入与计划摘要。每项恰好一次 passed、命令退出 0、清理完成才是 green；完整结果至少一项 failed 且命令非零退出才是 red。缺失、重复、额外、skip/todo、解析和基础设施失败为 invalid，不能用于 fixed。原生结果不自动满足 repository profile 的可靠性要求；旧 command 收据保留原件，不转换成新原生证明。
