# Decision

## Decision

Selected: [snapshots](plans/snapshots/README.md)

## Rationale

诊断可使用明确标识的历史结果；乐观读取与短提交允许查询和文档准备并行。

## Rejected Options

共享租约让全量扫描继续阻塞编辑，不满足 G1 与 G2。

## Residual Risks

持续来源变更可能使当前扫描重试；数据库占用可能暂时无法读取缓存。进程崩溃保留事务现场，不能用超时覆盖未知写入。
