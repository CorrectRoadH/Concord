# Goals

## G1: Nonblocking queries

诊断查询返回已完成的缓存结果并触发异步刷新；首次无缓存明确报告构建状态。扫描不持有 publication lease。

## G2: Concurrent preparation

普通文档写入的解析与规划不持有独占 lease，提交阶段重新验证依赖与完整前像。
