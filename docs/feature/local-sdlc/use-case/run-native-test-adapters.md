---
format: concord.document/v1
id: run-native-test-adapters
title: 通过 adapter 执行原生测试用例
createdAt: 2026-10-21T09:27:53.033Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 通过 adapter 执行原生测试用例

## 场景

作为使用 Node test、Vitest、pytest、Go 或 Cargo 的项目维护者，我希望显式收集框架原生清单，并按当前能力精确执行源码标记对应的原生用例，在收据中看到每个选中用例的真实结果。

## 主流程

1. 在 `concord.config.ts` 的 `testAdapters` 中为测试目录声明内置或外部 adapter。每项声明唯一 `id`、按路径段匹配的 `include`、`builtin` 或 `argv`、`implementationFiles`、`inputRoots`、精确 `frameworkVersion`、`lockFiles` 和环境变量名白名单 `envNames`。目录必须处于 `testRoots` 内；匹配范围不得相交。未覆盖的文件继续使用原 `runner`。
2. `concord test collect [<file>...]` 显式收集并在 HawDB 保存可丢弃的原生清单观察。`check`、`trace`、`test list` 与 `test show` 不运行收集；测试列表可展示带 `current`、`complete` 与 `gaps` 的观察。
3. `concord test run <case-id>` 在执行前重新收集目标文件。优先根据 provider 的完整声明范围绑定参数组；缺少范围时可使用同一标记块的 `@native <native-id>`。显式选择与可验证的自动绑定不同则失败。`@native`、原生标签与清单不改变 v1 测试关联身份。
4. 只有当前 provider 的收集范围完整且能力允许精确选择时才执行选中的原生 ID 集合。仓库外环境无法冻结时，观察保留 `ExternalInputUnknown`、`complete=false` 和版本；该环境 gap 不阻止原生选择与逐项收据。没有精确绑定时使用文件级 command scope；`--require-native` 或显式原生选择无法满足时返回 `NativeSelectionUnsupported`。
5. 原生收据格式为 `concord.native-evidence/v2`，记录 requested、observed、各 Invocation 状态与分配、输入和计划摘要、能力及 gap。全部选中项各出现一次且通过、命令退出 0、清理完成时为 green；结果完整且至少一项失败、命令非零退出、清理完成时为 red；缺失、重复、额外、skip、协议和基础设施失败均为 invalid。

## 约束

- `collectTimeoutMs`、`runTimeoutMs` 与 `wallTimeoutMs` 只能缩小默认上限 60000、300000 与 600000 毫秒。`budgets` 可缩小响应、输出、原生项、调用数及报告文件预算，不扩大设计硬上限。
- 外部 adapter 使用 `concord.test-adapter/v1`；每次请求启动一个受管子进程，stdin/stdout 各一个 JSON，stderr 只用于诊断。Concord 拥有原生 Invocation 的执行、状态裁决和报告目录。
- 原生 ID 包含 provider 命名空间。收集和选择能力与执行框架的精确版本绑定；缺少完整范围时不从 location 点推断范围。Go 顶层列举不证明动态子测试清单完整，额外原生结果不能计为通过。
- `inputScope` 展示纳入的仓库内成员摘要、排除项和版本记录。输入根内的文件、受管配置、adapter 实现与 `sourceFiles` 在结束后全部复核；排除项不得隐去实际依赖。系统库、工具链安装、外部服务与包缓存无法冻结时保留 `ExternalInputUnknown`。收据中的 `complete` 表示逐项报告完整，不能表示环境已冻结；带该 gap 的收据不能满足 repository profile 的原生可靠性等级。
- Cargo 多模块源码归属不能核实时返回 `CargoFileMembershipUnknown`。受管报告目录当前仅在 Linux 通过目录句柄安全读取，其它平台返回 `ReportUnsafe`。
- Node test 不具备已核实的独立原生收集能力时，观察显示 `NodeCollectionUnsupported`，不据此声明原生精确选择。Node runner 的既有 command 证据路径继续适用。
- `memory resolve --kind fixed` 仅接受当前输入、源码绑定、契约、实现和 Problem epoch 均符合要求的 red/green 收据。不同收据格式不混用，原生逐项结果不自动满足 repository profile 的原生可靠性要求。历史收据保留原件。
- 收集、选择、执行、解析及终结由同一个 runner 所有权覆盖。输入或成员变化、失效 epoch、非零收集退出、截断与清理未知均不授权当前清单或有效原生证明。清理未知时保留阻断现场。

## 验收

- 测试关联只由源码标记拥有；原生清单、标签与选择不改变 case 集合、case ID 或 `check` 结论。cold、warm、损坏与清空观察缓存时结论一致。
- 协议、绑定、输入身份与 run 协调遵守[采用设计](../../../design/test-adapters/plans/process-adapter/architecture.md)。收据裁决遵守[共同身份](../../../design/test-journey-steps/共同身份.md#原生执行收据)。
- 对固定版本的真实框架，在隔离 Git 消费者中验证打包 CLI 的收集、选择、逐项报告和进程终结；未核实的能力显示 false 与具名 gap。场景见 [CASES](../../../design/test-adapters/CASES.md)。
