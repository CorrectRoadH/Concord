# 各入口分别放宽校验

分别修改 CLI、页面编辑与高级治理中的英文正则或 ID 拼接。改动局部，但每个入口仍拥有一份规则，无法保证历史分类、写入与恢复一致，也容易遗漏 Web 路由。因此不采用。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-保留来源与安全写入边界) | satisfied | 各入口继续使用既有事务和源文件，不新增注册表。 | 方案只修改校验条件，不要求自动迁移或重签证据。 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-各入口使用同一身份与名称规则) | not-satisfied | 多个入口各自拥有路径规则，仍可能按 ID 重新拼接目标。 | 局部替换英文校验不能约束其他入口的定位与恢复行为。 |
