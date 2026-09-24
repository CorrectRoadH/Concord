# 共享文档布局与身份政策

名称、布局、owner 分类和选择器共用纯政策模块，严格解析共用 codec。各入口把身份解析到实际路径后，沿用自己的租约、前像校验和发布日志。Web 从实际 owner 生成路由，历史材料以只读原文展示。

优点是创建、发现、校验、编辑与恢复语义一致；成本是必须验证两个治理入口和浏览器。验收矩阵见 Design 主页面。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-保留来源与安全写入边界) | satisfied | 解析实际 owner 后冻结路径与前像，保留来源授权和日志恢复职责。 | 方案不引入身份注册表、消费者重命名或证据重签。 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-各入口使用同一身份与名称规则) | satisfied | CLI、高级治理与 Web 共用名称、布局、分类和选择器政策。 | 各入口依赖同一政策模块，创建默认值不参与现有 owner 定位。 |
