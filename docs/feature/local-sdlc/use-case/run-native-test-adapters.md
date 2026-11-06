# 通过 adapter 执行原生测试用例

## 用户目标

使用 Node test、Vitest、pytest、Go 或 Cargo 的项目维护者，想让 Concord 先收集测试框架自己的用例清单，再只执行源码标记对应的那几个原生用例，并在运行结果里看到每个选中用例的真实结果，而不是整个文件的一个退出码。

## 起始状态

- 一个 Go 模块，`go.mod` 在仓库根，测试在 `test/cart/cart_test.go`：

  ```go
  // @use-case docs/feature/cart/use-case/add-item.md#add
  func TestAddItem(t *testing.T) { ... }

  func TestRemoveItem(t *testing.T) {}
  ```

- `concord.config.ts` 已配置 `testRoots: ['test']` 与 `runner`。

## 主流程

1. 为测试目录声明 adapter。 {#configure}

   在 `concord.config.ts` 的 `testAdapters` 中加一项：

   ```ts
   testAdapters: [{
     id: 'go',
     include: ['test/cart'],
     builtin: 'go',
     implementationFiles: [],
     inputRoots: ['test/cart'],
     frameworkVersion: 'go1.26.10',
     lockFiles: ['go.mod'],
     envNames: ['PATH', 'HOME', 'GOCACHE', 'GOPATH'],
   }],
   ```

   每项声明唯一 `id`、按路径段匹配的 `include`、`builtin` 或 `argv`、`implementationFiles`、`inputRoots`、精确 `frameworkVersion`、`lockFiles` 和环境变量名白名单 `envNames`。`include` 必须处于 `testRoots` 内，各项的匹配范围不得相交。没被任何 adapter 覆盖的文件继续使用原 `runner`。超时与预算见[超时与预算](../cli.md#超时与预算)。

2. 收集原生清单。 {#discover}

   ```sh
   concord --json test discover
   ```

   `observations[0].observation.value.cases` 列出 Go 报告的两个用例（节选）：

   ```json
   [{"nativeId":"go:go:test/cart:test/cart/cart_test.go:TestAddItem","project":"test/cart","file":"test/cart/cart_test.go","kind":"leaf","selection":{"opaqueId":"TestAddItem","capabilityVersion":"go/go1.26.10/v1"},"tags":{},"provenance":"go/go1.26.10"},
    {"nativeId":"go:go:test/cart:test/cart/cart_test.go:TestRemoveItem","project":"test/cart","file":"test/cart/cart_test.go","kind":"leaf","selection":{"opaqueId":"TestRemoveItem","capabilityVersion":"go/go1.26.10/v1"},"tags":{},"provenance":"go/go1.26.10"}]
   ```

   同一次输出的 `capabilities` 中 `range` 为 false，`complete` 为 false，`gaps` 含 `RangeUnavailable`、`GoDynamicSubtestsUnknown` 与 `ExternalInputUnknown`：Go 不提供用例的源码范围，顶层列举也不证明动态子测试完整。

   清单是可丢弃的观察，保存在缓存中。`check`、`trace`、`test list` 与 `test show` 不运行收集；测试列表展示带 `current`、`complete` 与 `gaps` 的观察。

3. 要求精确运行一个原生用例。 {#select}

   ```sh
   concord test run neref_7aff36b4a3eda34d7d577e8eeacac0e8 --require-native
   ```

   ```text
   ok: false
   error: NativeSelectionUnsupported
   message: Current collection cannot authorize an exact native selection
   ```

   `test run` 在执行前重新收集目标文件。有 provider 给出的完整声明范围时，Concord 按范围把标记绑定到参数组；Go 没有范围，所以无法确定标记指的是哪个用例。在标记块里写明原生 ID：

   ```go
   // @use-case docs/feature/cart/use-case/add-item.md#add
   // @native go:go:test/cart:test/cart/cart_test.go:TestAddItem
   func TestAddItem(t *testing.T) { ... }
   ```

   `@native`、原生标签与清单都不改变测试关联身份，case ID 仍是 `neref_7aff36b4a3eda34d7d577e8eeacac0e8`。`@native` 与可验证的自动绑定不一致时运行失败。

4. 再次运行并读结果。 {#run}

   ```sh
   concord test run neref_7aff36b4a3eda34d7d577e8eeacac0e8 --require-native
   ```

   输出（节选）：

   ```text
   test run
   scope: native
   selectedCaseId: neref_7aff36b4a3eda34d7d577e8eeacac0e8
   commandOutcome: green
   ...
   requested: 
     go:go:test/cart:test/cart/cart_test.go:TestAddItem
   observed: 
     nativeId: go:go:test/cart:test/cart/cart_test.go:TestAddItem
     outcome: passed
     provenance: go/go1.26.10
   ...
   statuses: 
     invocationId: test-0
     exitCode: 0
     signal: none
     timedOut: false
     cancelled: false
     outputTruncated: false
     cleanup: complete
   ...
   complete: true
   gaps: 
     ExternalInputUnknown
   ```

   只执行了 `TestAddItem`，`TestRemoveItem` 没有运行。只有当前 provider 的收集范围完整且能力允许精确选择时，才执行选中的原生 ID 集合。仓库外环境无法冻结时，观察保留 `ExternalInputUnknown`、`complete=false` 和版本；这个环境缺口不阻止原生选择与逐项结果。没有精确绑定且没加 `--require-native` 时，按文件级 command scope 执行。

   原生运行结果记录 requested、observed、各 Invocation 状态与分配、输入和计划摘要、能力及 gap。裁决只有三种：

   - green：requested 非空，全部选中项各出现一次且通过，命令退出 0，清理完成。
   - red：结果完整，至少一项失败，命令非零退出，清理完成。
   - invalid：缺失、重复、额外、skip、协议和基础设施失败。

## 结果

选中的原生用例逐项给出真实结果。测试关联只由源码标记拥有（[关联身份与观察](../format.md#关联身份与观察)）：原生清单、标签与选择不改变 case 集合、case ID 或 `check` 结论。

| 情形 | 结果 |
| --- | --- |
| 冷、热、损坏与清空观察缓存 | `check` 结论一致 |
| 带范围的参数组 | 一个标记绑定整个展开组 |
| 缺少范围 | 要求 `@native`，或按文件执行 |
| 精确选择两项 | 实际只执行这两项，父 suite 初始化不冒充 leaf |
| 标记处于父 suite 与子 leaf 之间、重复全名或组范围重叠 | 按[绑定规则](../architecture.md#原生-adapter)唯一绑定；歧义为 `AmbiguousNativeBinding`，与自动绑定冲突为 `NativeSelectorConflict`，都是执行前失败 |
| 部分缺失、跳过、待办、未运行、重复或额外 ID | invalid |
| fixture、parser 与基础设施失败 | invalid，不是 red |
| 重试同一项、JUnit 名称碰撞或只有退出码 | 不压缩成单次 passed |
| Go 测试 | 列举只作顶层发现，动态子项需要真实运行观察，执行使用 `-count=1` |
| 跨 Cargo binary 或测试项目的参数组 | 拆成多个 Invocation，ID 含 package、target 与 binary |
| 收集中修改 fixture、配置、lockfile 或增加测试成员 | 不发布当前清单 |
| `node adapter.js` 的脚本变化 | 旧观察不能用于选择 |
| 超时后进程残留、取消或输出截断 | invalid；清理未知阻断发布 |
| symlink、特殊文件、目录逃逸、旧报告或超预算报告 | `ReportUnsafe` |
| 没有精确绑定，却加了 `--require-native` 或写了显式原生选择 | `NativeSelectionUnsupported` |

验收在隔离 Git 消费者中，对固定版本的真实框架验证构建 CLI 的收集、选择、逐项报告和进程终结，只对外部程序边界使用 fake。未经固定版本验收的框架组合不宣称支持，能力显示 false 与具名 gap。

## 约束

- 原生 ID 包含 provider 命名空间。收集和选择能力与执行框架的精确版本绑定；缺少完整范围时不从 location 点推断范围。Go 顶层列举不证明动态子测试清单完整，额外原生结果不能计为通过。
- 外部 adapter 按 [adapter 协议](../cli.md#adapter-协议) 通信，超时与预算只能缩小[默认上限](../cli.md#超时与预算)。
- `inputScope` 展示纳入的仓库内成员摘要、排除项和版本记录。输入根内的文件、受管配置、adapter 实现与 `sourceFiles` 在结束后全部复核；排除项不得隐去实际依赖。系统库、工具链安装、外部服务与包缓存无法冻结时保留 `ExternalInputUnknown`。运行结果中的 `complete` 表示逐项报告完整，不能表示环境已冻结。
- Cargo 多模块源码归属不能核实时返回 `CargoFileMembershipUnknown`。受管报告目录当前仅在 Linux 通过目录句柄安全读取，其它平台返回 `ReportUnsafe`。
- Node test 不具备已核实的独立原生收集能力时，观察显示 `NodeCollectionUnsupported`，不据此声明原生精确选择。Node 测试按文件级 command scope 执行。
- [修复核验](resolve-with-command-evidence.md)在缺陷提交与修复提交上各运行一次。缺陷提交上的结果须为 red，修复提交上须为 green；任一次为 invalid 时返回 `FixUnverifiable`。
- 收集、选择、执行、解析及终结由同一个 runner 所有权覆盖。输入或成员变化、失效标记、非零收集退出、截断与清理未知均不授权当前清单或有效原生结果。清理未知时保留阻断现场。

## Spec 来源

- 命令、配置与协议：[原生测试 adapter](../cli.md#原生测试-adapter)
- 绑定、输入身份与报告：[原生 adapter](../architecture.md#原生-adapter)
