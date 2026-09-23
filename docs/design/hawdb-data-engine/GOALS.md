# Goals

## G1: Unified engine

四类持久缓存和短期解析缓存使用 HawDB，不保留 SQLite 或另一套 Map 解析缓存。

## G2: Current projections

Memory/Issue 的派生索引绑定当前来源，删除和改动立即生效，可清除重建。

## G3: Independent installation

同一个包携带支持平台的产物，消费者无需 Rust、HawDB checkout 或数据库服务。
