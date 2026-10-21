---
format: concord.document/v1
id: test-adapters
title: 多框架测试 adapter
createdAt: 2026-10-21T07:34:14.443Z
kind: design
alternatives:
  - process-adapter
  - marker-extension
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-005
  - docs/constitution.md#c-007
  - docs/constitution.md#c-009
  - docs/constitution.md#c-010
  - docs/constitution.md#c-011
  - docs/constitution.md#c-013
decision:
  selected: process-adapter
  reason: 源码标记保持唯一关联来源，adapter 只在显式收集与执行时提供原生观察，保留 @native 后备；C-011 第 1、3 款已修订
  at: 2026-10-21T09:29:58.762Z
  targets:
    - docs/feature/local-sdlc/use-case/run-native-test-adapters.md
---

# 多框架测试 adapter

## Problem

源码关联不等于原生选择。不同框架的真实收集、参数化展开、选择与报告能力需要分开声明；名称模式也不能自动证明精确选择。

## Core Mental Model

关联与观察遵守[共同身份](../test-journey-steps/共同身份.md)。源码标记静态重建关联，原生清单只增强执行。原生标签可作展示元数据，不产生关联；tag-only 的契约字符串不进入引用校验。

两个候选均保持 v1 关联 ID：进程 adapter 使用真实收集加范围绑定，并提供显式 native selector 后备；扩展标记候选只提供显式 selector。`@name` 不是通用原生选择身份。

## Scope and Tradeoffs

静态 check 不读取清单。收集仅由显式 test collect 或 test run 的执行前阶段产生，可能执行项目初始化和测试代码。跨进程管理不构成文件系统或网络沙箱；配置 adapter 表示信任该程序具有当前用户的权限。

能力矩阵区分文档支持、静态候选与真实消费者验收，不承诺全部框架可精确绑定。JUnit XML 是报告 codec，不是收集或选择 provider。

## C-011 第 1、3 款拟议修订

第 1 款拟议条文：

> 测试根中的 Concord 标记是测试关联的唯一正向来源，标记存在即关联存在。静态关联扫描不解析宿主语言的测试声明、框架绑定、回调或 skip/todo。执行时的原生收集、绑定与选择仅按第 3 款进行，其观察结果不创建关联，也不授权静态关系检查成功。

第 3 款拟议条文：

> 执行由接入项目的 runner 命令或显式配置的 adapter 负责。adapter 可以仅在显式收集或执行前，把源码标记绑定到观察到的原生用例集合，或使用源码标记中的显式原生选择参数。原生选择不参与关联身份，不产生关联，不使静态检查依赖观察。只有能力和当前输入足以证明精确选择时，才声明选中了原生用例；否则执行范围按文件明确展示，要求原生精确选择的操作具名失败。缺少逐用例选择能力不使源码关联失效。

理由：第 1 款明确静态关联扫描的禁止边界，第 3 款明确显式执行观察的窄例外；第 2 款的标记词法规则保持不变。原生观察不拥有关系，缺少执行能力不影响静态关联。允许真实原生绑定取代名称猜测。来源为[共同身份](../test-journey-steps/共同身份.md)、[测试执行契约](../../feature/local-sdlc/use-case/discover-annotated-tests.md)与 [C-004](../../constitution.md#c-004)。

影响：新增执行配置、原生选择与带版本收据；旧收据保留并重新取证，逐项结果不自动提升可靠性等级。该文本是采用前置条件，不声明当前宪法允许新执行语义；须授权后通过 constitution amend 采用。C-005 保持不变，Concord 不维护 Go 或 Python 执行程序。

## Entry Points

- [Goals](GOALS.md)
- [Limits](LIMITS.md)
- [Cases](CASES.md)
- [Decision](DECISION.md)
- [进程 adapter](plans/process-adapter/README.md)
- [显式 selector](plans/marker-extension/README.md)
