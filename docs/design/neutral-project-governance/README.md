---
format: concord.document/v1
id: neutral-project-governance
title: 将项目专属流程归还消费者并统一治理模型
createdAt: 2026-09-20T07:01:18.077Z
kind: design
alternatives:
  - consolidate
  - generalize-profile
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-002
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-007
  - docs/constitution.md#c-008
  - docs/constitution.md#c-009
  - docs/constitution.md#c-010
decision:
  selected: generalize-profile
  reason: 独立 Herdr Astra design_grill 经 Q1–Q9 问答获 PASS：保留中立高级治理入口，归还产品工具，统一最低证据要求和 formal 校验，不重写原生执行编排。PASS 是设计裁决，实际消费者验收另行完成。
  at: 2026-09-20T07:07:09.887Z
  targets:
    - docs/feature/neutral-project-governance/README.md
---

# 将项目专属流程归还消费者并统一治理模型

## 问题

repository profile 将治理规则与具体产品工具组合在一起，host 必须提供产品协议和完整 runner 类型快照，静态发现依赖 Nx 和固定目录。直接删除会同时丢掉原生证据、可靠性核验和回归历史。

## 比较

- [合并基础入口](plans/consolidate/README.md)：最终减少实现重复，但需要同时重建成熟的正式证据链，扩大迁移面。
- [收敛为中立治理](plans/generalize-profile/README.md)：保留 `concord repo` 高级治理入口，归还产品工具，统一关键不变量并用中立协议和实际消费者验收证明边界。

当前提交独立挑战的是第二案；没有把代码目录名或来源当作通用性的证据。治理的最低要求与产品执行策略分离，固定证明要求不能通过换入口绕过。

## Entry Points

- [Goals](GOALS.md): requirements and comparison criteria.
- [Limits](LIMITS.md): constraints shared by every candidate.
- [Cases](CASES.md): neutral scenarios for the comparison.
- [Decision](DECISION.md): explanatory evidence.
Each candidate in plans/ is a self-contained feature design package.
The decision is recorded only by `concord design decide`; writing prose does not select a candidate.
