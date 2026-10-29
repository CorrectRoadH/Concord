---
format: concord.document/v1
id: neutral-project-governance
title: 统一项目治理与中立测试接入
createdAt: 2026-09-20T07:01:06.119Z
kind: feature
---


# 统一项目治理与中立测试接入

## 目标

软件项目采用 Concord 统一的 Spec、实现关联、测试治理与 Memory 规则。已有项目需要适配这些规则；不能以兼容某个消费者为由让其产品路径、运行通道或工具协议成为所有项目的前提。

NiceEval 是实践来源与接入消费者。公开入口验收、原生测试唯一绑定、候选与 Spec 一致性、red/green、隔离和清理等实践可以提升为中立规范；产品 Preview、示例素材同步、具体包名、Nx 配置与部署接口由消费者拥有。

## 强制规则

- Spec、实现声明、测试定义和 Memory 各有唯一 owner，反向关系派生；Spec 采用统一文档格式及分类布局。
- Feature 与 Use Case 明确目标和可观察验收，重要取舍通过 Design 记录；实现声明与测试声明显式关联 Spec。
- 测试声明、命令结果、原生 case 观察及可靠性结论必须区分。原生结果必须唯一绑定真实测试身份，证据必须匹配候选、Spec 和当前生命周期。
- Problem fixed 必须满足其证据要求。执行适配、迁移或界面变化不得将强证明要求降级为普通命令成功。
- 写入具备范围校验、前像冲突保护和中断恢复；历史证据保持原件，失效或不可用须如实显示。

## 项目职责

项目拥有测试框架、执行环境、运行通道、构建产物和部署方式。Concord 不把 host/provider、固定通道、特定产品包名或 Nx 布局当作通用治理字段。

本功能面向软件项目，不以纯文档项目作为方案成立或能力拆分的理由，不要求消费者采用 Concord 自身的开发栈。Concord 与消费者的所有权划分见[治理边界](architecture.md)，配置与证据要求见[高级测试治理](../../repository-profile.md)；Spec 声明不等于验收通过。产品工具归消费者、治理规则归 Concord（[决策依据](../../design/neutral-project-governance/DECISION.md)）。

## 用户路径

- [按 Concord 规范接入软件项目](use-case/adopt-neutral-governance.md)
- [组合仓库工作流命令](use-case/compose-repository-workflows.md)
- [计划并执行一次远端 Issue 写入](use-case/mutate-remote-issue.md)
- [并行切分文档工作](use-case/coordinate-docs-work.md)

## 性能预算

按[性能验收](../../engineering/concord-self-hosting/performance.md)的参照环境与七次采样判定，阈值为参照实测 p50 加约 20% 余量取整。

| 场景 | 测量内容 | p50 预算 |
| --- | --- | ---: |
| `neutral-project-governance/repo-features` | 冻结治理 fixture 的 Feature 列表 | 580ms |

## Constitution

- [C-001](../../constitution.md#c-001)
- [C-002](../../constitution.md#c-002)
- [C-003](../../constitution.md#c-003)
- [C-004](../../constitution.md#c-004)
- [C-006](../../constitution.md#c-006)
- [C-007](../../constitution.md#c-007)
- [C-008](../../constitution.md#c-008)
- [C-009](../../constitution.md#c-009)
- [C-010](../../constitution.md#c-010)
