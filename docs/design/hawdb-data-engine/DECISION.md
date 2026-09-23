# Decision

## Decision

Selected: [native-embedded](plans/native-embedded/README.md)

## Rationale

统一 HawDB 满足用户对持久与短期缓存的明确要求。实际原生探针证明所需存储、事务与内存 API 可用；来源 owner 和授权仍在既有边界内。独立挑战的有限定案条件已写入具体打开模式、锁 guard、资源预算及发行契约，并显式修订 c-001/c-005。实现后必须完成相应故障、性能与包体验收，不以设计结构检查替代测试。

## Rejected Options

keep-sqlite 保留当前安装复杂度，但继续维护两种数据缓存，不满足 G1。使用 HawDB CLI 或 helper 作为运行时控制面不符合上游嵌入式契约，因此不作为采用方案。

## Residual Risks

原生模块增加包体和平台构建成本；短期查询比 Map 有可观额外开销，批处理只能缓解。目录锁适配绑定上游 revision，升级必须复核。当前本机探针不能证明 macOS 执行或通用 Linux 发行；发布仍由同包平台矩阵阻断缺项。HawDB 不替代现有事实 owner、发布恢复日志或命令证据，也不把子串检索声称为 BM25。
