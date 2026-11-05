# 分析其它语言的代码声明与测试依赖

## 场景

作为多语言项目的维护者，我希望 Python、Go、Rust 等语言的实现代码也能声明 Spec 关联，并看到测试依赖中是否观察到声明同一 Spec 的实现。

## 主流程

1. 在非 JS/TS 源码的注释行写 `@concord-file`、`@concord-code`、`@concord-begin`、`@concord-end` 与 `@concord-implements`；注释前缀由 `languageServers[].profile` 声明。`check` 从源码重建这些关系。
2. 在 `concord.config.ts` 的 `languageServers` 中声明 language server。运行 `concord code analyze` 显式启动 server，取得符号定位与调用观察。JS/TS 测试的依赖观察由内置 TypeScript 编译器提供，不启动 server。
3. `code list`、`trace show` 与 `test show` 展示符号定位与相关性判定：`observed` 带层级，`not-observed` 带具名缺口。

## 验收

关系身份、观察结构与相关性判定见[关联身份与观察](../format.md#关联身份与观察)，绑定、调用观察与分析生命周期见[多语言分析](../architecture.md#多语言分析)。

以构建打包后的 CLI 在隔离 Git 消费者中验证；可控 LSP 进程只模拟协议边界与异常。声明某语言受支持前，须对该 server 的固定版本运行真实语言 fixture，并按语言、server 版本与 profile 版本分别给出源码关系、符号定位与调用观察的证据；证据不足时只承诺标记关系与具名缺口。

- 函数、类内方法、装饰器与同名声明定位到最近正确节点；不能验证时定位标记行并带 `UnsupportedSymbolBinding`，关系仍存在。扁平符号、`null`、越界范围与错误嵌套不构造层级，非 BMP 位置按协商编码换算。
- 冷、热、损坏与清空缓存时，`check` 的退出码、finding、`complete`、当前关系与关联 ID 相同，只有 locator 与观察状态变化。
- 经 testRoots 中转调函数调用同一步骤实现时为 `observed`、level 为 `step` 并保留 `OpenWorldCalls`；只观察到其它 Feature 实现时为 `not-observed`。超出默认深度 3、能力缺失、动态调用、框架回调与子进程边界带对应缺口。
- server 启动失败、超时、取消、超输出或主进程退出后子进程存活时具名失败，并核验整个进程组与管道清理；清理未知保留 runner 阻断。分析期间修改转调文件、fixture、配置、成员集合或 server 实际脚本时整个分析单元拒绝发布。
- 原生清单的范围、绑定或选中集合变化时观察输入身份变化；无范围时使用文件级并带 `FileScope`，测试关联 ID 与 `check` 关系不变。
- server 发出编辑或执行请求时拒绝；server 自行修改项目文件由输入复核检出。任何静态入口、`test run` 与编辑器服务都不启动 language server。
- 固定源码、profile、server 与可复现环境时，清空后重新分析的关系与身份相同；环境或索引无法核验时标明缺口，不承诺无条件相同。

## 具名结果

| code | 结果 |
| --- | --- |
| `InvalidLanguageServer` | 配置、扩展名、路径或预算无效，启动前拒绝 |
| `UnsupportedSymbolBinding`、`CapabilityMissing` | 保留标记关系与标记行，记为观察缺口 |
| `IndexReadinessUnknown`、`PartialResult` | 不声称符号或调用集合完整 |
| `LanguageServerFailed`、`AnalysisBudgetExceeded`、`AnalysisCancelled` | 清理进程组，不发布新观察 |
| `AnalysisSourceChanged`、`AnalysisInputUnverified` | 拒绝当前观察，旧结果只作历史 |
| `AnalysisCleanupUnknown` | 保留 runner 阻断，不发布 |

## 配置与结果

`languageServers` 每项声明 `id`、`languageId`、完整后缀 `extensions`、`argv`、仓库内 `cwd`、`initializationOptions`、`implementationFiles`、`sourceFiles`、`profile` 与 `budgets`。`typescript` 是内置分析器的保留 ID。ID 与扩展后缀不得重复或重叠，不接受 JS/TS 后缀。`cwd: '.'` 表示仓库根。

`profile` 声明 `version`、固定 `serverVersion`、`commentPrefixes`、LSP `declarationKinds`、`symbolShape`。符号形态为 `document-symbol`；其它字段包括 `decorators`、`leadingComments`、`readiness` 与 `positionEncodings`。注释前缀只接受 `#`、`//`、`--`、`;`；装饰器策略为 `none` 或 `at-line`，不加载项目解析脚本。

就绪策略为 `none` 或带 `token` 的 `progress`；无可验证信号时保留 `IndexReadinessUnknown`。位置编码接受 UTF-16、UTF-8 与 UTF-32；server 未选择时按 UTF-16 校验，双方必须明确支持所用编码。

`implementationFiles` 至少声明一个真实入口，并包含脚本、插件和依赖锁。显式输入缺失时返回 `AnalysisInputUnverified`，server 未确认固定版本时也拒绝发布。`environment` 只允许显式选择 PATH、LANG、LC_ALL、TZ、TMPDIR 与 SYSTEMROOT；凭据不传递给 server。

观察返回输入摘要、分析器与 profile、时间、`current`、`complete` 和 `gaps`。调用观察始终保留 `OpenWorldCalls`；文件级归因保留 `FileScope`。未核验的 SDK、外部环境与私有索引保留 `UnverifiedEnvironment`。LSP 无法核验的动态派发、子进程与协议边界分别保留 `UnknownDynamicDispatch`、`UnknownSubprocessBoundary` 与 `UnknownProtocolBoundary`。静态读取不启动 server，缺失、损坏与陈旧观察不影响源码关系。

JS/TS 依赖观察跟随已捕获范围内的静态 import 与 re-export。动态 import、未解析模块、网络、子进程、深度和节点上限分别形成缺口；文件依赖不证明该文件每个测试都调用实现。

只有显式 `code analyze` 执行受信 server。分析器拒绝编辑和执行请求，进程组清理不能代替文件或网络沙箱。server 自行改写输入时返回 `AnalysisSourceChanged`；超时、取消或清理不确定时不发布新观察。

`current` 表达仓库内输入一致性；复核通过的 LSP 观察为 `current: true`，可用于符号定位与相关性判定。仓库外 SDK、外部环境与私有索引无法核验时保留 `UnverifiedEnvironment`，`complete` 为 false。仓库内输入变化后，旧观察只作历史展示。

## 原生测试范围

分析可读取已收集且当前的原生 manifest，不触发收集器。绑定得到的全部原生用例都提供范围时，LSP 从这些范围内的可调用符号开始分析。`analysis.relevance[].scope` 此时为 `native-case`；缺失、陈旧、歧义或无范围时保守使用 `file`，并保留具名缺口。

原生范围不由选择器或测试名字猜测。分析身份包含 manifest 内容摘要、输入摘要、版本、绑定及选择范围；任一变化使旧观察失效。`ExternalInputUnknown` 保留在结果中，不阻止当前仓库范围的使用，也不证明原生可靠性。内置 TypeScript import 分析保持文件级范围。
