# 静态关联与进程 adapter

## Entity Ownership

配置拥有 adapter 定义；源码标记拥有测试关联；清单、范围绑定和标签为共同契约的 `Observation<T>`；evidence 拥有不可伪造升级的执行收据。身份与结果结构引用[共同身份](../../../test-journey-steps/共同身份.md)。

配置项包含 `id`、testRoots 内按路径段匹配的 `include`、内置名称或外部 `argv`、实现文件集合、输入根、精确框架版本与锁文件、环境变量名白名单、collect/run 超时和预算。根路径必须在仓库内。禁止不同配置 include 范围重叠，含父子范围；`test/a` 不匹配 `test/ab`。未匹配文件使用原 runner。

外部 adapter 是受信执行程序，具有用户权限；协议要求它只计划和解析，但进程组不是安全沙箱。Concord 不维护其它语言 adapter 的源码，不把它们加载进进程。

## 协议 envelope

`concord.test-adapter/v1` 使用每请求一个新进程、stdin 一个 JSON、stdout 一个 JSON。stderr 仅诊断。未知字段、重复键、非有限数和超限值拒绝。请求响应均含 format、op、requestId；响应必须回显 planId 与 inputs。

```ts
interface Invocation {
  readonly invocationId: string;
  readonly argv: readonly [string, ...string[]];
  readonly cwd: string;
  readonly envNames: readonly string[];
  readonly reports: readonly string[];
}
interface Context {
  readonly root: string;
  readonly runId: string;
  readonly planId: string;
  readonly inputs: string;
  readonly reportDirectory: string;
}
interface Request {
  readonly format: 'concord.test-adapter/v1';
  readonly op: 'collect-plan' | 'collect-parse' | 'select-plan' | 'report-parse';
  readonly requestId: string;
  readonly context: Context;
  readonly payload: unknown; // 按 op 的严格 Schema 解码
}
interface ProcessStatus {
  readonly invocationId: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly outputTruncated: boolean;
  readonly cleanup: 'complete' | 'unknown';
}
interface Completeness {
  readonly complete: boolean;
  readonly gaps: readonly string[];
}
```

collect-plan 输入 files 与成员摘要，输出非空 Invocation[] 和可严格解码的 planContext。collect-parse 输入同一 context、planContext、全部调用状态、捕获输出与受管报告描述，输出 cases、capabilities、completeness。select-plan 输入去重 nativeIds 与当前清单身份，输出非空 Invocation[] 及各调用负责的 requested 子集；report-parse 输入同一计划、requested、状态和报告，输出 observed、capabilities、completeness。

capabilities 必须分别声明真实收集、leaf/参数组、精确选择、逐项报告、范围、标签与 skip 可见性。每项观察带 provenance。静态 AST 候选不能把 realCollection 标为 true。范围缺失就是缺失，不用单行 location 伪造 end。

Invocation 的 argv 无 shell 展开、至少一个非空参数；cwd 是安全仓库相对目录，envNames 只从配置白名单取环境，不允许响应携带任意秘密值。参数包含的秘密不记录。每个 report 路径是 Concord 分配目录内的相对路径。

## 报告文件与预算

Concord 为每个 run 分配新的 reportDirectory，每个 invocation 独占子目录，执行前为空；外部程序不得选择任意历史路径。最多 64 个普通文件、单个 8 MiB、合计 32 MiB；拒绝 symlink、硬链接多重别名、特殊文件、目录逃逸及不是本次调用产生的文件。以安全目录句柄读取并复核文件身份，读取后变化也拒绝。XML 禁止 DTD 与外部实体。

每个协议响应最多 8 MiB，stdout/stderr 合计每调用 16 MiB，原生项最多 100000，Invocation 最多 128，收集默认 60 秒、测试默认 300 秒；配置只能在硬上限内缩小。超时、输出截断与取消不能由 parser 的成功响应覆盖。总 wall time 受整个 run 的上限限制，默认 600 秒。目录清理在最后一个使用者结束后进行，失败保留具名恢复信息，不发布有效原生收据。

## 框架版本能力矩阵

“文档”只说明对应接口存在，未完成固定消费版本的原生验收；未确认不是支持。range 表示完整可绑定声明范围，位置点不满足该能力。

| 框架 | 版本依据 | static candidate | 真实收集 | 精确选择 | 逐项报告 | range |
| --- | --- | --- | --- | --- | --- | --- |
| Node test | 官方 v26.12.0 文档；消费版本未确认 | TS 字面量候选，非运行发现 | 未确认 | 名称模式；重复全名与动态子项未确认 | TAP/事件接口；身份一一映射未确认 | AST 候选，不证明运行绑定 |
| Vitest | v4 文档；本地 4.1.11 | 字面量候选 | list JSON；skip 完整性未确认 | 文件与名称模式，重复全名未确认 | reporter 存在；provider 映射未确认 | location 点；完整范围未确认 |
| Jest | 官方 30.5 文档；消费版本未确认 | 字面量候选 | collectTests 文档能力；listTests 仅文件 | 名称模式；同全名不可据此独选 | JSON；映射与完整性未确认 | 完整范围未确认 |
| pytest | 文档版本与消费版本未确认 | 非 Concord 宿主语法解析 | 需消费者 hook/provider，未确认 | nodeid 方案，参数组映射未确认 | 需 nodeid 与报告映射，未确认 | 需 provider 包含装饰器/end，未确认 |
| Go | 官方 go 命令；精确版本未确认 | 不维护 go/ast 程序 | list 仅顶层，动态子项需执行观察 | 分段 -run 有限制；-count=1 | -json；完整映射未确认 | 未确认 |
| Cargo/libtest | 官方文档；stable/nightly 精确版本未确认 | #[test] 候选不覆盖宏/cfg | list 按 binary；harness=false 不适用 | binary 加 --exact；多 binary 拆调用 | 稳定逐项协议未确认；不依赖未固定 nightly JSON | 未确认 |
| JVM provider | Launcher/Maven/Gradle 具体版本未确认 | 未确认 | 未确认；XML 不是发现协议 | 未确认 | JUnit XML 只是 codec，身份映射未确认 | 未确认 |

依据：[Node test](https://nodejs.org/api/test.html#filtering-tests-by-name)、[Vitest v4 CLI](https://v4.vitest.dev/guide/cli#vitest-list)、[Jest CLI](https://jestjs.io/docs/cli#--collecttests)、[pytest API](https://www.pytest.org/en/latest/reference/reference.html)、[Go 命令](https://pkg.go.dev/cmd/go)、[Cargo test](https://doc.rust-lang.org/cargo/commands/cargo-test.html)。兼容支持须另以固定框架、运行时和 adapter 实现摘要验收，不能由矩阵推导全满足。

## 原生项与范围

原生 ID 必须包含 provider 命名空间；跨项目或 binary 的局部名称不得直接复用。每个原生项含 `nativeId / project / file / kind / group / range / selection / tags`；kind 仅 leaf 或 suite。group 和 range 可缺失，但不得用空值伪装为已知。

range 包含以 1 为起点的 startLine/endLine（两端包含）及源码摘要，必须落在当前 file 的真实行数内。selection 包含框架不透明 ID 与能力版本。tags 只是键值元数据。

group 相同的项必须共享声明范围和 project，且拥有不同的 nativeId。provider 需明确范围是否覆盖注释、装饰器及属性；能力未声明时不把相邻文本推断为 trivia。

complete=false 必须有非空 gaps；complete=true 不保证调用行为完整，只表示当前 provider 声明的收集范围完整。标签、range 或 skip 可见性不具备时单列能力缺口，不宣称完整原生绑定。

## 绑定与显式后备

先按 provider 的 group key 归并参数项；key 包含项目、文件、声明范围与组身份，不凭同名合并。同组不同 ID 可共享范围，全部展开项组成选择集。suite 只组织 leaf，不能与 leaf 混为执行结果。

标记块从首个关联标记到其连续元数据末行。自动绑定优先最内层包含标记的唯一 leaf 组；否则选择紧随其后的唯一 leaf 组，中间只允许空白及 provider 明确覆盖的注释/装饰器 trivia。有普通语句、同深度重叠、缺范围或只有 suite 时不自动绑定。

同块可写一个 `@native <opaque-id>`，可以与 `@name` 共存；它只作显式选择后备，不进入关联派生。自动绑定缺失时使用它；二者均可验证且不一致时 `NativeSelectorConflict`，不得静默覆盖。多个原生项用真实参数组绑定；未收集参数组不得用模式冒充完整集合。

多标记可以指向同一 leaf 或不同契约，同目标关系按现有规则展示且保留来源；执行集按 native ID 去重，一次结果可投射到多个关联。原生标签不参与绑定和关系。执行歧义属于执行前失败，不是 check finding。没有精确绑定时明确文件级；明确要求 native 的操作失败，不静默扩大。

## collect 输入身份与 run 协调

inputs 绑定项目/root 身份、测试/源码/配置成员集合及其字节、fixture、导入支持文件、构建配置、conftest、lockfile、框架和运行时版本、adapter 真正脚本及传递实现文件、选择能力、算法版本与选中组范围。`node adapter.js` 必须摘要 adapter.js，不能只摘要 node。输入根保守覆盖 sourceRoots/testRoots 与全部受管配置，记录纳入和排除项。

依赖环境、系统库或外部服务不能完整冻结时 complete=false，并列 `ExternalInputUnknown`；这类清单不能授权 native 证明。sourceFiles 不是依赖闭包的证明；未声明或无法核验的实际输入使当前操作失败。

在任何 adapter 进程启动前取得与现有 runner 相同的 run lease/失效 epoch，捕获 config、definition、candidate、contract 身份和完整成员快照，关闭来源句柄及快照后再运行外部进程。run 所有权贯穿收集、选择、执行、报告与终结，短发布协调不跨外部调用。

结束后重新读取全部输入与成员集合，核对摘要和 run invalidation；有漂移、非零收集退出、截断、缺失调用或 cleanup unknown 均拒绝发布当前清单。全部句柄先关闭，再进入 owned publication lease 核对前像并发布。失败可保留旧清单，但只能历史展示；test run 总是重收集需要的当前集合，失败不能使用旧项选择。

## 收据裁决

requested、observed 及各 Invocation 状态进入有新版本的原生收据。外层字段 `commandOutcome` 表达 green/red/invalid，命令级执行数量另存，不扩展既有 execution enum 混用语义。

共同契约拥有 green/red/invalid 的规则。裁决还要求输入未漂移、协议/报告完整、计划与结果一一绑定、全部调用均有终结状态；基础设施错误 invalid。重试不得合并多个事件伪装一次 passed，当前协议拒绝重复终态，可靠性重跑由独立执行与收据表达。任何额外 ID（包括非 requested 的 leaf）均 invalid。

## Errors

协议与输入失败为 `AdapterProtocolInvalid`、`ReportUnsafe`、`CollectFailed`、`InputChanged`。

选择与清理失败为 `NativeSelectorConflict`、`AmbiguousNativeBinding`、`NativeSelectionUnsupported`、`CleanupUnknown`。失败不改变静态关联与 check；原生失败报告不可伪装 red。

## Identity and Reuse

v1 源码关联不随绑定、清单或标签变化。原生选择、执行计划、完整输入、协议/codec 版本进入新定义摘要及收据。历史收据保留原件，不能重算成新版本；新能力须重新取证。采用要求见 Design 的 C-011 拟议条文。
