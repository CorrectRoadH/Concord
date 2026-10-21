# 受控写作规则

## L1: 规则由目录作用域的写作政策拥有

规则、词表与豁免由 `concord-writing.json` 拥有。controlled 按叶子最近显式值合成，词表按最近显式整表替换，不新增强制规则来源（[C-001](../../constitution.md#c-001)）。

## L2: 不分发规范原文且不宣称合规

Concord 不分发 ASD-STE100 原文或词典，不宣称符合该规范或获得 ASD 认证。免费获取不代表再分发授权，项目维护自己的词表（[Research](../../research/ste-writing-rules/README.md)、[C-004](../../constitution.md#c-004)）。

## L3: 门禁确定且不依赖外部进程

门禁只读当前输入快照，不运行外部命令、网络或模型。显式外部建议独立于门禁，不能覆盖其 finding 或完整性（[C-010](../../constitution.md#c-010)、[C-007](../../constitution.md#c-007)）。

## L4: 只接受当前格式并显式迁移

采用 v3 时，普通入口只接受 v3。旧政策通过显式 CAS 迁移，旧事务先由匹配 CLI 恢复；保留旧收据与原件，不自动补写（[C-009](../../constitution.md#c-009)）。

## L5: 检查成本受规模和输出预算约束

匹配成本受输入与实际输出控制；词表及输出均有明确上限。高频命令须按[性能验收](../../engineering/concord-self-hosting/performance.md)测量，未取得必需数据不能称性能通过（[C-014](../../constitution.md#c-014)）。

### 候选

[政策规则](plans/policy-rules/README.md) 在 v3 中定义两条计数路径与内置检查。

[内置门禁与显式外部建议](plans/external-linter/README.md) 采用相同内置政策，增加独立、显式调用的建议入口。
