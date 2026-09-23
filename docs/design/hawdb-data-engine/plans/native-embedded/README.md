# native-embedded

## Problem

统一缓存与检索引擎必须保持本地事实和可安装性。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-source-ownership) | satisfied | 机制与约束见本页 | [研究依据](../../../../research/hawdb-integration/README.md) |
| [L2](../../LIMITS.md#l2-lifecycle-and-safety) | satisfied | 机制与约束见本页 | [研究依据](../../../../research/hawdb-integration/README.md) |
| [L3](../../LIMITS.md#l3-packaging-and-implementation) | satisfied | 机制与约束见本页 | [研究依据](../../../../research/hawdb-integration/README.md) |
| [L4](../../LIMITS.md#l4-bounded-behavior) | satisfied | 机制与约束见本页 | [研究依据](../../../../research/hawdb-integration/README.md) |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-unified-engine) | satisfied | 机制与约束见本页 | [研究依据](../../../../research/hawdb-integration/README.md) |
| [G2](../../GOALS.md#g2-current-projections) | satisfied | 机制与约束见本页 | [研究依据](../../../../research/hawdb-integration/README.md) |
| [G3](../../GOALS.md#g3-independent-installation) | satisfied | 机制与约束见本页 | [研究依据](../../../../research/hawdb-integration/README.md) |

## Mechanism

Node 通过窄 N-API bridge 调用固定 revision 的 HawDB 公开 facade。关系缓存使用参数化 SQL；参数不拼进语句。领域决策、严格 Schema、源摘要和发布授权由 TypeScript/Effect 维护。原生边界限于嵌入式引擎、类型转换、预算和句柄生命周期。

Git-private 的版本化 HawDB 目录容纳注解、代码、配置及远端观察命名空间。持久句柄在短快照内按需打开和复用，在 lease 释放前关闭，不跨网络请求或 Web 空闲时间持有。只读发现不能因为命名空间缺失创建表。缺失、损坏和占用分别沿用具名诊断与当前来源回退，不静默使用过期数据。

短期文档解析、代码解析及不可变 Git 测试基线使用 HawDB 内存实例。纯解析入口不依赖 Repository 或磁盘目录；namespace 区分数据，源摘要与解析器身份区分代次。缓存有条目数及字节上限，不另存 Map payload 缓存。批量加载采用有界批量读取/写入；一次请求的临时结果集合不构成第二个缓存。

Memory/Issue 的 index 和 recall 继续核对当前目录和源字节；共享的解析投影改用 HawDB。现有子串查询及排序不被伪装为 BM25 或语义检索。Trace 的关系有效性、权限和 fixed 仍从当前权威输入推导。

清理在独占 repository lease 内执行，须区分活动句柄和损坏库。打开失败本身不代表可删除；具体所有权证明经独立挑战确定。只清理受管缓存目录和显式列出的 SQLite 历史残留，不读取或迁移旧 SQLite，不删除 evidence/journal。远端缓存丢失后只有显式刷新可以重新获得观察，本地已捕获 Issue 保留。

原生依赖、Rust toolchain 与 Cargo lock 精确固定。构建编排保持严格 TypeScript/Effect；c-005 与 AGENTS 的窄原生例外在采用前显式修订。发行流程先在 Ubuntu 与 Apple Silicon macOS 构建 native 产物，再装入同一个 tgz，通过目标系统的真实安装后才能发布。消费者不需要 Rust、全局 HawDB 或安装脚本。缺少或错误的平台产物返回具名错误，不隐藏切回 SQLite。

## Evidence and tradeoffs

[研究与探针证据](../../../../research/hawdb-integration/README.md)确认 Node 24 的真实调用、普通事务回滚、持久重开和内存命名空间能力。stripped release 原型约 19 MiB；本机 Nix 构建不能作为通用 Linux 发布物。探针不证明进程崩溃恢复、生产安全、跨平台兼容或完整 Concord 延迟。

HawDB 统一引擎会增加原生包体、构建矩阵、查询与序列化成本。相同 1000 篇合成文档的热解析投影由旧 Map 约 4.6 ms 增至朴素 HawDB 约 110 ms；有界批量原型约 33 ms。数字只说明优化方向，实际 CLI/Web 的源检查、Schema 解码、预算清理和资源释放必须单独验收。

## Open modes and ownership

构造配置读取、feedback 观察和 status 仅 existing-only/read-only 打开；缺目录、格式标记、ownership 文件或表时不补写，回源或报告 empty/unavailable。dry-run 不创建持久引擎文件。Concord 当前 shared/exclusive 名称均进入同一个短期独占文件临界区，不引入新的锁升级协议。

最外层 snapshot 拥有按需句柄，嵌套调用只复用。只读句柄需要写入时，在同一 repository lease 内关闭后重新以写模式打开；没有跨调用逃逸的 native transaction。所有路径都先释放数据库，再释放 repository lease。纯解析的无磁盘内存句柄属于进程，关闭或失效后允许重建。

clear 先关闭本进程受管持久句柄，在独占 repository lease 下通过 native guard 对固定 revision 的 owner.hawdb.lock 执行非截断 File::try_lock。只在取得锁后删缓存数据，保留目录和同一个锁 inode。WouldBlock、权限、I/O 或未知错误均拒绝删除；损坏 manifest 不影响独立取锁。owner-only 目录视为空。缺锁文件只在明确写入/clear 且路径已验证时创建，读取与 dry-run 不补建。非目录缓存根、symlink、硬链接锁、特殊文件或前后 inode 不符均拒绝。

该锁适配是对固定 revision 协议的显式窄依赖，不是 HawDBError 字符串推断，也不绕过公开数据 API。互斥保证覆盖遵守 Concord 协调协议和已持有 HawDB 文件锁的进程；不宣称抵抗任意外部路径替换。

## Resource budgets

预算按序列化 UTF-8 字节计入 namespace、key、source envelope 和 payload，不把字符数当字节数。以下为固定初始上限，超过上限返回具名失败或按原有语义回源，不返回截断成功。

| Namespace | Entry limit | Byte limit |
| --- | ---: | ---: |
| 文档短期解析 | 10000 | 16 MiB |
| 代码短期解析 | 10000 | 16 MiB |
| Git baseline | 128 | 4 MiB |
| annotation_cache | 64 | 24 MiB |
| code_cache | 20000 | 32 MiB |
| config_cache | 128 | 8 MiB |
| feedback_cache | 10000 | 32 MiB |

内存缓存总逻辑预算 36 MiB，持久缓存总逻辑预算 96 MiB。淘汰采用可解释的插入顺序；新批次自身超过预算则整批拒绝，不能提交部分结果。短期内部代次按累计写入/删除量有界重建，避免只删除逻辑行而无限累积引擎 tombstone；重建期间旧/新实例合计最多两份既定逻辑预算。

桥接单条输入最多 8 MiB，每次批量最多 1000 条且总输入最多 16 MiB。native 查询最多 20000 行、64 MiB payload；大于该预算的完整 namespace 读取须分批且仍受 namespace 总预算约束。持久目录最多 4096 个条目、256 MiB；超出时不继续打开和扩大，显式 clear 可在同一安全遍历预算内处理，否则具名拒绝。

HawDB 的 max_wal_replay_entries=100000、max_wal_replay_bytes=128 MiB、max_wal_record_bytes=64 MiB、max_wal_batch_operations=50000；checkpoint encoded<=256 MiB、decoded<=512 MiB；segment cache=16 MiB、graph manifest=8 MiB、out-of-core delta<=16 MiB。严格恢复，不自动修复坏 WAL；不用上游 TiB 级默认解码额度。达到 4 MiB WAL 增量或累计 32 个写事务后执行公开 checkpoint，失败使缓存不可用并保留现场；只读不 checkpoint。内存表定期重建与持久 checkpoint 都是缓存维护，不改来源。

同批重复 feedback identity 按输入顺序与本批已合并值继续比较；保留单调时间戳和同版本冲突语义，最后一个 putBatch 原子发布。

## Release identity

发行产物集合固定为 linux-x64-glibc 与 darwin-arm64，后者 deployment target 为 macOS 14.0，符合当前 Ubuntu 24.04 与 Apple Silicon macOS 14/15 验收矩阵。native manifest 绑定同一桥接源码、Cargo lock、ABI、HawDB revision 和二进制摘要。构建先清空 dist，再汇入完整平台集合；后续 host build 不能擦掉其它目标。只 pack 一次，各平台验证同一个 SHA-256。缺项或不匹配阻断发行，本机 Nix 产物不进入通用发行物。

## Adoption conditions

独立 Astra 挑战为 CONDITIONAL，区分以下定案条件与实现后验收：所有权 guard、明确打开模式、明确预算、窄原生例外和发行身份。定案条件分别由本页的 Open modes and ownership、Resource budgets、Release identity，以及修订后的 constitution c-001/c-005、AGENTS 和架构契约落实。

所有权原型验证了同进程与跨进程互斥、损坏 manifest 的受锁清理、同一锁 inode 保留和空库重开。预算字段已核对固定 revision 的公开 DatabaseConfig，不采用 TiB 级默认值。生产路径守卫、崩溃恢复、实际缓存语义、真实请求延迟及打包消费者属于实现后验收，本设计不声称它们已经通过。

clear 的进一步边界：目录不存在时无操作；只有完整预检为 owner-only 的目录才报告 empty，未知内容不归为空。删除并不原子化；中断或部分失败保留现场，后续显式 clear 可重新取 guard 继续，不自动调用数据库恢复。原型仅覆盖同进程双向互斥及跨进程 guard 阻止 HawDB，反方向和明确 busy 类别由生产测试补齐。
