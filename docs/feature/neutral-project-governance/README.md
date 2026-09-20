---
format: concord.document/v1
id: neutral-project-governance
title: 统一项目治理与中立测试接入
createdAt: 2026-09-20T07:01:06.119Z
kind: feature
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-002
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-006
  - docs/constitution.md#c-007
  - docs/constitution.md#c-008
  - docs/constitution.md#c-009
  - docs/constitution.md#c-010
---

# 统一项目治理与中立测试接入

## 目标

软件项目采用 Concord 统一的契约、实现关联、测试治理与工程记忆规则。已有项目需要适配这些规则；不能以兼容某个消费者为由让其产品路径、运行通道或工具协议成为所有项目的前提。

NiceEval 是实践来源与接入消费者。公开入口验收、原生测试唯一绑定、候选与契约一致性、red/green、隔离和清理等实践可以提升为中立规范；产品 Preview、示例素材同步、具体包名、Nx 配置与部署接口由消费者拥有。

## 强制规则

- 契约、实现声明、测试定义和 Memory 各有唯一 owner，反向关系派生；契约采用统一文档格式及分类布局。
- Feature 与 Use Case 明确目标和可观察验收，重要取舍通过 Design 记录；实现声明与测试声明显式关联契约。
- 测试声明、命令结果、原生 case 观察及可靠性结论必须区分。原生结果必须唯一绑定真实测试身份，证据必须匹配候选、契约和当前生命周期。
- Problem fixed 必须满足其证据要求。执行适配、迁移或界面变化不得将强证明要求降级为普通命令成功。
- 写入具备范围校验、前像冲突保护和中断恢复；历史证据保持原件，失效或不可用须如实显示。

## 项目职责

项目拥有测试框架、执行环境、运行通道、构建产物和部署方式。Concord 不把 host/provider、固定通道、特定产品包名或 Nx 布局当作通用治理字段。

本功能面向软件项目，不以纯文档项目作为方案成立或能力拆分的理由。具体中立能力与消费者迁移边界由 [Design](../../design/neutral-project-governance/README.md) 在独立挑战后定案；本页不宣称尚未实现的验收已通过。

## 用户路径

- [按 Concord 规范接入软件项目](use-case/adopt-neutral-governance.md)
