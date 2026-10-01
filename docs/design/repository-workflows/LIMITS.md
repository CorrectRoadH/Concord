# 仓库工作流贡献的约束

## L1: 完整图裁决不接受部分输入

需要完整关系图的结论与写入（Memory fixed 解决、case 关系与 regression 维护、删除或改名可能被测试标记引用的 owner）在任何 finding 存在时拒绝。只新增或修改自身 owner、不消费 case 关系的写入不受测试源码 finding 阻断。来源：[C-013](../../constitution.md#c-013)。通过条件：有 finding 时第一类命令零写入并具名失败，第二类命令照常完成。

## L2: 远端写入只在当次明确授权后发生

plan 不发出远端写请求；execute 没有与当次计划的动作、目标和 payload 一致的显式授权串时零远端调用。receipt 不携带授权，过期、已消费、远端前像或仓库身份变化都要求重新 plan。Agent 不能从 plan 结果推断授权。凭据只来自外部工具登录态。来源：[C-007](../../constitution.md#c-007)、[C-012](../../constitution.md#c-012)。通过条件：fake 远端记录的写调用次数。

## L3: 写入遵守前像与恢复契约

所有本地写入（Issue 生命周期、Docs Work 状态）校验路径、前像与完整变更集，失败保留可解释现场，不覆盖未知编辑。来源：[C-003](../../constitution.md#c-003)。

## L4: 破坏兼容的变更有迁移说明

被移除的命令返回具名错误并指向替代命令；不保留两套写语义。持久化的 Issue 格式与字段含义不变，合并后的写入前置条件不弱于任一既有入口。新增 JSON 字段与错误码在契约中声明。来源：[C-007](../../constitution.md#c-007)、[C-009](../../constitution.md#c-009)、[C-015](../../constitution.md#c-015)。

## L5: 执行与副作用通过 Effect 服务

新增实现不直接调用同步子进程或 `new Date()`；子进程 shell=false、有超时与进程组回收。来源：[C-005](../../constitution.md#c-005)。
