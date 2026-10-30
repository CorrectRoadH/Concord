---
format: concord.document/v1
id: adopt-neutral-governance
title: 按 Concord 规范接入软件项目
kind: use-case
feature: docs/feature/neutral-project-governance/README.md
---

# 按 Concord 规范接入软件项目

## 用户目标

维护者将有真实实现和测试的软件项目接入 Concord，以同一套 Spec、关联、Memory 与审阅规则管理开发，而不复制其它产品的仓库工具。

## 完整路径

1. 项目声明自身源码和测试位置，采用 Concord 文档 owner 与宪法条款。
2. Feature / Use Case 定义目标与可观察验收；实现和真实测试声明引用 canonical Spec。
3. 查询、追踪与 Web 展示从权威源码派生关系，不因项目没有某个产品的通道、包名或 host 而失败，也不隐式运行测试。
4. 通过项目实际执行入口收集结果，按声明的证明范围解释；需要原生或额外可靠性证明时不能使用 command evidence 替代。
5. Problem 根据当前生命周期和证据要求关闭；证据陈旧、缺失、身份歧义或清理失败具名拒绝。
6. 用打包后 Concord 与真实消费仓库验证接入，保留历史原件、未完成事务及未知编辑。

## 验收

通过打包后公开 CLI 在隔离 Git 项目中执行；不用伪造收据代替真实执行，静态检查与真实闭环互不替代：

- 没有 NiceEval/Nx 产品配置、通道或执行器分类的软件项目用 command 证据完成 Spec→实现/测试关联→执行→Memory→审阅闭环；源码声明不被显示为执行通过。
- 非 e2e 目录的声明式 suite 能静态查询；host 加载即失败时 help、trace 与 Web 仍可用，缺能力只阻断对应命令。
- 只安装自身 runner 依赖、不安装 Concord 库的非 NiceEval、非 Nx 项目，经 [repository adapter](../../../repository-profile.md#按需原生能力)完成 inventory、red、单项 green、隔离/同副本/并行观察、cleanup、关系发布、fixed 与 reopen。重新关闭时拒绝旧 epoch 与已使用 invocation。
- 已采用 native 要求的 Problem 从任意入口拒绝 command fixed，删除配置不能降级。
- 源码、Spec、adapter 实现、候选包、epoch、副本身份或 cleanup 改变，同副本不连续、隔离副本相同、零执行、skip、retry 与清理失败均被拒绝，历史原件字节不变。
- adapter 返回未知字段、重复键、错误 requestId、额外 stdout、超限输出、非零退出、超时、取消或残留子进程时具名失败，没有有效收据、残留进程或跨调用响应复用；包括强杀 adapter 时仍在运行且忽略 TERM 的嵌套子进程，以及清理无法核实后拒绝后续能力调用。
- 活跃旧锁、pending journal、中断迁移与未知前像不能被新入口绕过；迁移不改写旧证据字段或摘要来伪造当前证明。
- NiceEval 用同一安装候选、新配置和真实 runner 完成一套无付费、无远端副作用的正式可靠性闭环，计划与打包不加载 Concord 库，产品 E2E expected 零 diff；完整产品矩阵交给其 CI。
- 原有 Web 未提交编辑保留；验收不 push、不发布、不做远端写入或付费调用。

## Spec 来源

- [统一项目治理](../README.md)
- [治理边界](../architecture.md)
- [宪法](../../../constitution.md)
- [决策依据](../../../design/neutral-project-governance/DECISION.md)
- [进程接入决策依据](../../../design/repository-process-adapter/DECISION.md)
