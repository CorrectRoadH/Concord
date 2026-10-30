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

## Constitution

- [C-001](../../constitution.md#c-001)
- [C-002](../../constitution.md#c-002)
- [C-003](../../constitution.md#c-003)
- [C-004](../../constitution.md#c-004)
- [C-007](../../constitution.md#c-007)
- [C-008](../../constitution.md#c-008)
- [C-009](../../constitution.md#c-009)
- [C-010](../../constitution.md#c-010)
