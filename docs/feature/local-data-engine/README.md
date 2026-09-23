---
format: concord.document/v1
id: local-data-engine
title: 统一的本地缓存与检索引擎
createdAt: 2026-09-23T04:17:20.388Z
kind: feature
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-002
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-005
  - docs/constitution.md#c-006
  - docs/constitution.md#c-007
  - docs/constitution.md#c-008
  - docs/constitution.md#c-009
  - docs/constitution.md#c-012
---

# 统一的本地缓存与检索引擎

Concord 的持久缓存与派生检索由统一嵌入式数据引擎承接。源码、Markdown、结构化 JSON 与命令证据继续由原 owner 拥有；删除数据库不能删除契约、Memory、Issue 或证据，也不能改变 fixed 判定。

目标引擎为 HawDB。注解、代码、配置及远端反馈快照不再依赖 SQLite。短期文档与代码解析缓存同样使用 HawDB，保持容量上限、当前源字节身份与可丢弃语义，不另建 Map 解析缓存。缓存必须严格解码、核对来源摘要，并在不可用时保留现有回源或具名诊断行为。检索索引的命中必须对应当前来源，不返回删除或变更后的陈旧正文。

CLI 与 Web 使用同一入口和生命周期约束。安装包在支持的 Linux 与 macOS 上携带所需运行产物，消费者无需 Rust 编译器、HawDB checkout、全局程序或额外数据库服务。目标平台缺少产物须明确诊断，不以另一个数据库冒充 HawDB。

迁移方案、原生边界、锁与跨平台打包须经独立挑战后采用；本 Feature 声明目标，不证明实现已通过验收。

## 验收入口

- [替换持久缓存](use-case/use-unified-cache.md)
- [管理当前来源的检索投影](use-case/query-current-projections.md)
