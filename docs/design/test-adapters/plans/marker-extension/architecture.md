# 显式 native selector

## Entity Ownership

本候选不实现原生收集和自动范围绑定。关联只由 `@feature`、`@use-case` 源码标记拥有，沿用[共同身份](../../../test-journey-steps/共同身份.md)的 v1。`@native` 是选择元数据，不创建关系，不参与关联 ID。

```python
# @use-case docs/feature/login/use-case/expired-token.md#reject-token
# @name expired-case
# @native tests/test_auth.py::test_expired
def test_expired(): ...
```

同一标记块至多一个 `@native`，允许与 `@name` 共存。native 值是非空单行不透明字符串，最多 4096 UTF-8 字节，不允许 NUL；不解释为正则。多标记可选择同一 ID，执行时去重并保留关联来源。参数组必须列出独立标记或使用消费者 provider 可验证的完整组，不能把组名模式当完整成员集合。

配置新增可选 selector runner：安全 include、非空 argv、精确 codec/provider 版本、输入根、实现文件、环境变量名白名单、报告路径和预算。按路径段匹配 include，不允许配置间父子范围重叠。已有 runner 配置不变；没有 @native 的标记仍明确按文件执行。

## 计划与报告协议

外部 codec 只作受信的计划与解析程序，通过 stdio 每请求一个新进程，不加载进 Concord。协议 envelope 为 `concord.test-adapter/v1`，含 `op / requestId / planId / runId / inputs`，响应回显全部身份；stdout 仅一个严格 JSON。仅使用 `select-plan` 与 `report-parse`，不提供 collect。

Concord 分配 reportDirectory，select-plan 接收源码给出的 requested 集合与 context，返回非空 Invocation[] 和严格解码的 planContext。每个 Invocation 含唯一 invocationId、非空 argv、安全仓库相对 cwd、白名单 envNames、受管相对 reports 和负责的 requested 子集。不得遗漏或重复分配 ID；多 Cargo binary、多个项目必须拆调用。

report-parse 接收同一 plan/context、全部捕获状态与报告描述，返回 observed 项、capabilities、complete 与 gaps。observed 每项包含 nativeId 和 passed/failed/skipped/not-run/error；额外 ID、重复或缺失均显式保留。codec 不能自行宣告进程成功。

Concord 捕获每个 invocation 的 exitCode、signal、timedOut、cancelled、outputTruncated、cleanup，独立裁决。parser 的可解码 JSON 不能覆盖非零基础设施失败、超时或输出截断。没有精确选择能力或完整逐项报告时，只能保留 command scope；要求 native 的操作返回 `NativeSelectionUnsupported`。

`{native}` 如作为配置便利写法，必须独占一个 argv 参数，每个 ID 展开为单独参数，不通过 shell 或字符串拼接。框架若只接受名称正则，provider 必须转义并证明当前集合唯一；同名无法区分则拒绝精确选择。

## 报告限制与资源

每次 run 的目录新建且为空，每个 invocation 独占子目录。最多 64 个报告、单个 8 MiB、合计 32 MiB；仅普通文件，拒绝 symlink、硬链接别名、特殊文件、旧报告、目录逃逸与读取期间身份变化。XML 禁止 DTD 和外部实体，JUnit XML 的 classname/name 不能默认等同 nodeid，必须由固定 provider 给出无碰撞映射。

协议响应最多 8 MiB，单调用 stdout/stderr 合计 16 MiB，原生项最多 100000、Invocation 最多 128。默认每测试调用 300 秒，整个 run 600 秒；配置只能缩小硬上限。取消和超时终结整个进程组，清理未知阻断发布。目录在最后一个使用者终结后清理，失败保留具名恢复信息。

外部程序具有当前用户权限，进程组管理不是文件系统/网络沙箱。“不执行测试”是 codec 的协议职责，不是强制隔离保证。

## Data Flow

1. 静态解析关联与 @native；check 不读取任何观察，原生标签不产生关联，native 不存在也不使静态关系消失。
2. 显式 test run 在启动 codec 前取得现有 runner 的 run lease/失效 epoch，读取 config、definition、candidate、contract 与全部输入身份，关闭来源句柄，再开始外部调用。
3. 去重 requested，生成计划并执行所有 Invocation，收集原始状态和报告；Concord 统一裁决。
4. 结束重新读取完整输入与成员集合，关闭句柄后短期取得发布协调；漂移、失效或清理未知拒绝发布有效原生结果。

输入包括项目/root、源码与测试成员集合、fixture、配置、lockfile、构建条件、实际 codec/provider 脚本与依赖实现、运行时/框架版本、选择参数、算法版本及环境约束。不能只摘要 argv0。环境依赖不能核验时 complete=false 并带 `ExternalInputUnknown`，不能授权 native 证明。

## 收据与能力边界

收据遵守共同契约的 requested/observed 与 green/red/invalid 规则；仅非空集合全部恰好一次 passed、退出 0、完整且清理完成才能 green。全部恰好一次且含 failed、退出非零、清理完成才可能 red；基础设施错误、skip、缺失、重复、额外、重试合并、截断一律 invalid。

外层 `commandOutcome` 表达结论，不把 invalid 加入现有 execution enum。收据采用新格式版本，旧收据保留原件、不重算摘要，需要重新取证；逐项结果不自动满足 repository profile。

TAP 与 JUnit XML 只是候选报告 codec；没有固定 provider/版本的一一身份映射，G3 为 partial。exit-code 只能产生命令级证明。各框架精确版本与原生组支持均须真实消费者验收，不能宣称所有输出 XML 的框架都支持此候选。

## Errors

`InvalidAnnotation` 用于重复或非法 @native；`NativeSelectionUnsupported` 用于能力不足；`ReportUnsafe`、`AdapterProtocolInvalid`、`InputChanged`、`CleanupUnknown` 用于执行失败。不存在的 native 在执行时表现为缺失结果，结论 invalid。

## Identity and Reuse

native 选择变更保持源码 v1 ID，但改变定义摘要；命名测试改契约由 annotation/contract 摘要使旧收据失效。缓存有无不改变 case 集合、check finding、退出码与 complete。采用新选择语义前须完成 Design README 的 C-011 第 1、6 款修订。
