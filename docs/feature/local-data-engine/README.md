
# 统一的本地缓存与检索引擎

Concord 的持久缓存与派生检索由统一嵌入式数据引擎承接。源码、Markdown、结构化 JSON 与命令证据继续由原 owner 拥有；删除数据库不能删除 Spec、Memory、Issue 或证据，也不能改变 fixed 判定。

Cache namespace 区分各类投影及资源预算。Ownership guard 覆盖缓存目录的清理过程，取得守卫后才允许删除缓存数据，锁文件及其 inode 保留。

目标引擎为 HawDB，承接注解、代码、配置及远端反馈快照。短期文档与代码解析缓存同样使用 HawDB，保持容量上限、当前源字节身份与可丢弃语义，不另建 Map 解析缓存。当前来源缓存必须严格解码、核对来源摘要，并在不可用时保留回源或具名诊断行为。诊断历史投影按[异步查询 Spec](use-case/query-asynchronous-projections.md)返回构建时结果，不授权当前事实门禁。检索索引的命中必须对应当前来源，不返回删除或变更后的陈旧正文。

CLI 与 Web 使用同一入口和生命周期约束。安装包在支持的 Linux 与 macOS 上携带所需运行产物，消费者无需 Rust 编译器、HawDB checkout、全局程序或额外数据库服务。目标平台缺少产物须明确诊断，不以另一个数据库冒充 HawDB。

原生边界、句柄与清理所有权、资源预算及诊断投影的刷新协议见[架构](architecture.md)，发行产物见[跨平台发布架构](../cross-platform-release/architecture.md#身份与复用)（[决策依据](../../design/hawdb-data-engine/DECISION.md)）。

## 验收入口

- [替换持久缓存](use-case/use-unified-cache.md)
- [管理当前来源的检索投影](use-case/query-current-projections.md)

- [读取异步诊断投影](use-case/query-asynchronous-projections.md)

## 依据的品味与底线

- [一件事只写一次，其余推导](../../constitution.md#c-019)
- [独立、本地、可安装](../../constitution.md#c-002)
- [写入遵守范围和恢复 Spec](../../constitution.md#c-003)
- [只声称证明过的](../../constitution.md#c-021)
- [维护代码采用严格 TypeScript 与 Effect](../../constitution.md#c-005)
- [用产品自身管理和验收开发](../../constitution.md#c-006)
- [尊重协作与外部操作授权](../../constitution.md#c-007)
- [总则](../../constitution.md#general-amend)
- [写现在，不写过去](../../constitution.md#c-020)
- [快到每次都愿意跑](../../constitution.md#c-023)
