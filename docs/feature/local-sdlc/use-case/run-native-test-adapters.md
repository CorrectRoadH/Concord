# 通过 adapter 执行原生测试用例

## 场景

作为使用 Node test、Vitest、pytest、Go 或 Cargo 的项目维护者，我希望显式收集框架原生清单，并按当前能力精确执行源码标记对应的原生用例，在运行结果中看到每个选中用例的真实结果。

## 主流程

1. 在 `concord.config.ts` 的 `testAdapters` 中为测试目录声明内置或外部 adapter。每项声明唯一 `id`、按路径段匹配的 `include`、`builtin` 或 `argv`、`implementationFiles`、`inputRoots`、精确 `frameworkVersion`、`lockFiles` 和环境变量名白名单 `envNames`。目录必须处于 `testRoots` 内；匹配范围不得相交。未覆盖的文件继续使用原 `runner`。
2. `concord test collect [<file>...]` 显式收集并在 HawDB 保存可丢弃的原生清单观察。`check`、`trace`、`test list` 与 `test show` 不运行收集；测试列表可展示带 `current`、`complete` 与 `gaps` 的观察。
3. `concord test run <case-id>` 在执行前重新收集目标文件。优先根据 provider 的完整声明范围绑定参数组；缺少范围时可使用同一标记块的 `@native <native-id>`。显式选择与可验证的自动绑定不同则失败。`@native`、原生标签与清单不改变 v1 测试关联身份。
4. 只有当前 provider 的收集范围完整且能力允许精确选择时才执行选中的原生 ID 集合。仓库外环境无法冻结时，观察保留 `ExternalInputUnknown`、`complete=false` 和版本；该环境 gap 不阻止原生选择与逐项结果。没有精确绑定时使用文件级 command scope；`--require-native` 或显式原生选择无法满足时返回 `NativeSelectionUnsupported`。
5. 原生运行结果记录 requested、observed、各 Invocation 状态与分配、输入和计划摘要、能力及 gap。requested 非空、全部选中项各出现一次且通过、命令退出 0、清理完成时为 green；结果完整且至少一项失败、命令非零退出、清理完成时为 red；缺失、重复、额外、skip、协议和基础设施失败均为 invalid。

## 约束

- `collectTimeoutMs`、`runTimeoutMs` 与 `wallTimeoutMs` 只能缩小默认上限 60000、300000 与 600000 毫秒。`budgets` 可缩小响应、输出、原生项、调用数及报告文件预算，不扩大设计硬上限。
- 外部 adapter 使用 `concord.test-adapter/v1`；每次请求启动一个受管子进程，stdin/stdout 各一个 JSON，stderr 只用于诊断。Concord 拥有原生 Invocation 的执行、状态裁决和报告目录。
- 原生 ID 包含 provider 命名空间。收集和选择能力与执行框架的精确版本绑定；缺少完整范围时不从 location 点推断范围。Go 顶层列举不证明动态子测试清单完整，额外原生结果不能计为通过。
- `inputScope` 展示纳入的仓库内成员摘要、排除项和版本记录。输入根内的文件、受管配置、adapter 实现与 `sourceFiles` 在结束后全部复核；排除项不得隐去实际依赖。系统库、工具链安装、外部服务与包缓存无法冻结时保留 `ExternalInputUnknown`。运行结果中的 `complete` 表示逐项报告完整，不能表示环境已冻结。
- Cargo 多模块源码归属不能核实时返回 `CargoFileMembershipUnknown`。受管报告目录当前仅在 Linux 通过目录句柄安全读取，其它平台返回 `ReportUnsafe`。
- Node test 不具备已核实的独立原生收集能力时，观察显示 `NodeCollectionUnsupported`，不据此声明原生精确选择。Node 测试按文件级 command scope 执行。
- [修复核验](resolve-with-command-evidence.md)在缺陷提交与修复提交上各运行一次。缺陷提交上的结果须为 red，修复提交上须为 green；任一次为 invalid 时返回 `FixUnverifiable`。
- 收集、选择、执行、解析及终结由同一个 runner 所有权覆盖。输入或成员变化、失效 epoch、非零收集退出、截断与清理未知均不授权当前清单或有效原生结果。清理未知时保留阻断现场。

## 验收

- 测试关联只由源码标记拥有（[关联身份与观察](../library.md#关联身份与观察)）；原生清单、标签与选择不改变 case 集合、case ID 或 `check` 结论。cold、warm、损坏与清空观察缓存时结论一致。
- 带范围的参数组由一个标记绑定整个展开组；缺少范围时要求 `@native` 或按文件执行。精确选择两项时实际只执行这两项，父 suite 初始化不冒充 leaf。标记处于父 suite 与子 leaf 之间、重复全名或组范围重叠时按[绑定规则](../architecture.md#原生-adapter)唯一绑定，歧义为执行失败。
- 部分缺失、跳过、待办、未运行、重复或额外 ID 为 invalid；fixture、parser 与基础设施失败不是 red。重试同一项、JUnit 名称碰撞或只有退出码时不压缩成单次 passed。
- Go 列举只作顶层发现，动态子项需要真实运行观察，执行使用 `-count=1`。跨 Cargo binary 或测试项目的参数组拆成多个 Invocation，ID 含 package、target 与 binary。
- 收集中修改 fixture、配置、lockfile 或增加测试成员时不发布当前清单；`node adapter.js` 的脚本变化使旧观察不能用于选择。超时后进程残留、取消或输出截断为 invalid，清理未知阻断发布。symlink、特殊文件、目录逃逸、旧报告或超预算报告以 `ReportUnsafe` 拒绝。
- 对固定版本的真实框架，在隔离 Git 消费者中验证打包 CLI 的收集、选择、逐项报告和进程终结，只对外部程序边界使用 fake。未经固定版本验收的框架组合不宣称支持，能力显示 false 与具名 gap。

## 协议

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

`collect-plan` 之前取得 run 所有权，见[原生 adapter](../architecture.md#原生-adapter)（[决策依据](../../../design/test-adapters/DECISION.md)）。
