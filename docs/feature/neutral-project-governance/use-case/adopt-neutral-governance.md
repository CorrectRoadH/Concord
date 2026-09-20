---
format: concord.document/v1
id: adopt-neutral-governance
title: 按 Concord 规范接入软件项目
createdAt: 2026-09-20T07:01:17.224Z
kind: use-case
feature: docs/feature/neutral-project-governance/README.md
---

# 按 Concord 规范接入软件项目

## 用户目标

维护者将有真实实现和测试的软件项目接入 Concord，以同一套契约、关联、Memory 与审阅规则管理开发，而不复制其它产品的仓库工具。

## 完整路径

1. 项目声明自身源码和测试位置，采用 Concord 文档 owner 与宪法条款。
2. Feature / Use Case 定义目标与可观察验收；实现和真实测试声明引用 canonical 契约。
3. 查询、追踪与 Web 展示从权威源码派生关系，不因项目没有某个产品的通道、包名或 host 而失败，也不隐式运行测试。
4. 通过项目实际执行入口收集结果，按声明的证明范围解释；需要原生或额外可靠性证明时不能使用 command evidence 替代。
5. Problem 根据当前生命周期和证据要求关闭；证据陈旧、缺失、身份歧义或清理失败具名拒绝。
6. 用打包后 Concord 与真实消费仓库验证接入，保留历史原件、未完成事务及未知编辑。

## 验收结果

- 一个没有 NiceEval/Nx 产品配置的隔离软件项目能够完成契约→实现/测试关联→执行→Memory→审阅闭环。
- NiceEval 使用同一中立规范，并拥有自己的执行、产品工具及额外策略。
- 源码声明不被显示为执行通过；正式证明要求不会因迁移消失。
- 迁移没有通过改写旧证据字段或摘要伪造当前证明。

## 契约来源

- [统一项目治理](../README.md)
- [宪法](../../../constitution.md)
- [设计比较](../../../design/neutral-project-governance/README.md)
