# 保留全局有效性门禁

所有操作继续加载全仓库文档；默认持独占 snapshot，发现任意来源错误立即失败。只修补死锁提示和 recover 输出。

## Goals

| Requirement | Status | Mechanism or gap | Evidence |
|---|---|---|---|
| [G1](../../GOALS.md#g1-local-operations) | not-satisfied | 无关文档仍阻断局部查询 | 全仓库 loadDocuments 调用链 |
| [G2](../../GOALS.md#g2-read-concurrency) | not-satisfied | 默认独占 | CLI 默认访问行为 |
| [G3](../../GOALS.md#g3-explain-recovery) | satisfied | 可单独增加资源报告 | 不需修改文档依赖 |
| [G4](../../GOALS.md#g4-complete-diagnosis) | not-satisfied | 首个错误中止 | 严格全量解析 |

## Limits

| Requirement | Status | Mechanism or gap | Evidence |
|---|---|---|---|
| [L1](../../LIMITS.md#l1-preserve-publication-safety) | satisfied | 保留现有事务 | 原恢复验收 |
| [L2](../../LIMITS.md#l2-preserve-evidence) | satisfied | 保留证据门禁 | 原证据验收 |
| [L3](../../LIMITS.md#l3-exact-ownership) | satisfied | 全量解析后匹配 | 现有引用检查 |
| [L4](../../LIMITS.md#l4-recover-exact-owners) | satisfied | 保留精确 token 回收 | 原竞争恢复验收 |
