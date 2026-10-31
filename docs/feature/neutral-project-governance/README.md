
# 统一项目治理与中立测试接入

## 目标

软件项目采用 Concord 统一的 Spec、实现关联、测试关联、Issue 与 Memory 规则。已有项目需要适配这些规则；不能以兼容某个消费者为由让其产品路径、运行通道或工具协议成为所有项目的前提。

NiceEval 是实践来源与接入消费者。公开入口验收、候选与 Spec 一致性、先失败后修复的回归核验、隔离和清理等实践提升为中立规范；产品 Preview、示例素材同步、具体包名、Nx 配置与部署接口由消费者拥有。

## 强制规则

- Spec、实现声明、测试定义、Issue 和 Memory 各有唯一 owner，反向关系派生；Spec 采用统一布局，身份由路径推导。
- Feature 与 Use Case 明确目标和可观察验收，重要取舍通过 Design 记录；实现声明与测试声明显式关联 Spec。
- 测试声明与执行结果必须区分；源码标记不显示为执行通过，`test run` 的结果不声称逐 case 覆盖或正式可靠性。
- Issue 以 fixed 关闭前必须通过[修复核验](../local-sdlc/scope.md#证据的范围)。执行适配、入口或界面变化不得把核验降级为普通命令成功。
- Concord 的写入具备范围校验、前像冲突保护和中断恢复；直接编辑的可信度由 `check --since <base>` 门禁保证（[决策依据](../../design/sdd-core-model/DECISION.md)）。

## 项目职责

项目拥有测试框架、执行环境、运行通道、构建产物和部署方式。Concord 不把 host/provider、固定通道、特定产品包名或 Nx 布局当作通用治理字段。

本功能面向软件项目，不以纯文档项目作为方案成立或能力拆分的理由，不要求消费者采用 Concord 自身的开发栈。Concord 与消费者的所有权划分见[治理边界](architecture.md)，测试执行边界见[项目测试接入边界](../../repository-profile.md)；Spec 声明不等于验收通过。产品工具归消费者、治理规则归 Concord（[决策依据](../../design/neutral-project-governance/DECISION.md)）。

## 用户路径

- [按 Concord 规范接入软件项目](use-case/adopt-neutral-governance.md)
- [计划并执行一次远端 Issue 写入](use-case/mutate-remote-issue.md)
- [并行切分文档工作](use-case/coordinate-docs-work.md)

## Constitution

- [C-019](../../constitution.md#c-019)
- [C-002](../../constitution.md#c-002)
- [C-003](../../constitution.md#c-003)
- [C-021](../../constitution.md#c-021)
- [C-006](../../constitution.md#c-006)
- [C-007](../../constitution.md#c-007)
- [总则](../../constitution.md#general-amend)
- [C-020](../../constitution.md#c-020)
