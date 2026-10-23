# 多框架测试 adapter

## L1: 正向关系由测试源码拥有

只有 Concord 源码标记拥有关系。清单、原生标签、原生 ID 都不能创建或改变 case ID、case 集合与 check 结论（[C-001](../../constitution.md#c-001)、[C-011](../../constitution.md#c-011)）。

## L2: 静态操作不执行项目代码

check 不读取观察；其它静态视图仅可展示带 current 与完整性状态的观察，不启动收集（[C-010](../../constitution.md#c-010)、[C-013](../../constitution.md#c-013)）。

## L3: 不把第三方代码加载进 Concord 进程

Concord 维护代码采用 TypeScript/Effect；外部 adapter 及消费者插件是独立受信程序，不隐含新的原生例外（[C-005](../../constitution.md#c-005)）。

## L4: 子进程资源归 Concord 管理

从 collect-plan 前取得 run 所有权；所有进程、报告目录、超时和取消受协调。清理未知阻断发布，输入漂移拒绝当前结果（[C-003](../../constitution.md#c-003)、[C-013](../../constitution.md#c-013)）。

## L5: 证据只表达实际证明的范围

Schema、进程状态和集合一致性共同裁决收据。命令级与原生级证明分开，fixed 遵守 repository profile（[C-004](../../constitution.md#c-004)、[C-009](../../constitution.md#c-009)）。

## L6: 既有配置含义不变

不配置新增能力时沿用原 runner。新增配置使用严格当前 Schema，显式启用；不得凭缓存自动切换语义。C-011 第 1、6 款修订是新选择语义的采用条件。
