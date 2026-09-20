# 运行时兼容（未采用）

继续解码 JSON 配置、使用旧 owner 或恢复缺当前配置绑定的事务，会保留多个运行时授权模型，并违反用户明确的无 legacy 约束。拒绝此方案；历史数据交给显式离线迁移，当前运行时只检测并具名拒绝旧格式。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-不提供旧版本运行时兼容) | not-satisfied | 继续解码 JSON、使用旧 owner 并恢复旧事务，正是被拒绝的 legacy 行为。 | 原候选正文明确记载该行为。 |
| [L2](../../LIMITS.md#l2-保留协调文件与领域语义) | pending | 原候选正文未说明共享 lease、journal 障碍和领域语义如何保留。 | 缺少协调边界证据。 |
| [L3](../../LIMITS.md#l3-离线脚本独立拥有历史数据迁移) | not-satisfied | 运行时本身继续恢复旧事务，不能把历史迁移独立交给离线脚本。 | 原候选正文明确运行时兼容行为。 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-普通入口只接受静态-ts-配置) | not-satisfied | 继续解码 JSON 配置，普通入口不再只接受当前静态 TS。 | 原候选正文明确 JSON 兼容。 |
| [G2](../../GOALS.md#g2-旧现场拒绝不破坏恢复现场) | not-satisfied | 恢复旧事务会把旧授权重新纳入运行时，违反拒绝和现场保护边界。 | 原候选正文明确恢复缺当前绑定事务。 |
