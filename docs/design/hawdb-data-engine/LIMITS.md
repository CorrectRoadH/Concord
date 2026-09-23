# Limits

## L1: Source ownership

Markdown、JSON、源码与证据保持各自所有权；缓存不能决定授权、fixed 或关系有效性。

## L2: Lifecycle and safety

一个持久目录同一时间仅有一个进程/root handle；持久句柄、事务和缓存清理在短 lease 生命周期内结束；无磁盘内存句柄按进程管理，不持锁等待网络。拒绝 unsafe path 和 symlink，故障不破坏来源。

## L3: Packaging and implementation

HawDB revision、Rust toolchain、bridge 依赖和构建锁固定。原生代码仅覆盖无法以 TS 调用的引擎桥接，领域与构建逻辑保持 strict TypeScript/Effect；采用前明确修订 c-005 与 c-001。Linux/macOS 支持不静默缩水。

## L4: Bounded behavior

读写有 payload/row/缓存总量边界，短期解析有容量限制，缓存失效语义与旧入口一致。冷启动、命中和大项目耗时有实测证据；不得把成功退出当成性能或故障恢复证明。
