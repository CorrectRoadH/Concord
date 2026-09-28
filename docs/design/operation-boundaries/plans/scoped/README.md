# 按操作依赖划分边界

## Goals

| Requirement | Status | Mechanism or gap | Evidence |
|---|---|---|---|
| [G1](../../GOALS.md#g1-local-operations) | satisfied | 按来源、精确路径与归属链读取 | Cases 中的无关损坏与目标损坏场景 |
| [G2](../../GOALS.md#g2-read-concurrency) | satisfied | 显式 read/write 访问与乐观快照 | 跨进程互斥验收 |
| [G3](../../GOALS.md#g3-explain-recovery) | satisfied | 回收事实与 runner 阻塞结果 | 无 journal 死 owner 及 quarantine 场景 |
| [G4](../../GOALS.md#g4-complete-diagnosis) | satisfied | 全局收集解析 findings | 多处损坏的 check 验收 |

## Limits

| Requirement | Status | Mechanism or gap | Evidence |
|---|---|---|---|
| [L1](../../LIMITS.md#l1-preserve-publication-safety) | satisfied | 保留乐观快照、独占提交和前像 journal | 原恢复与并发测试继续通过 |
| [L2](../../LIMITS.md#l2-preserve-evidence) | satisfied | 证据与 runner 门禁保持 | 不改变 fixed validator |
| [L3](../../LIMITS.md#l3-exact-ownership) | satisfied | 路径精确读取、短 ID 范围扫描 | 错误目标、歧义与归属链验收 |
| [L4](../../LIMITS.md#l4-recover-exact-owners) | satisfied | 同主机 ESRCH、token 精确删除 | 真实进程死亡与竞争恢复验收 |

## Architecture

操作矩阵、精确读取、乐观读取竞争和恢复结果的完整约定见 [architecture.md](architecture.md)。

Repository 负责安全文件访问、当前配置、snapshot、publication 和 journal；不决定业务查询要加载哪些文档。access: read 使用乐观来源核验 并禁止真正 publish；非 dry-run 的普通 access: write 只在提交阶段使用独占 lease。dry-run 是写操作的规划结果，沿用乐观快照并禁止实际发布，不充当只读命令分类。

文档读取区分三种依赖：指定 kinds 的目录范围扫描；canonical reference 的目标和最近 README 归属链；全局诊断扫描。严格边界解码不变。集合扫描不吞掉范围内错误；全局诊断将逐文件错误收集为 findings，并阻止依赖完整图的裁决。局部注释验证 exact reference、类型、anchor、Use Case 的 Feature 和 regression Problem，不扫描无关代码或测试。

Memory/Issue 列表、检索与正文编辑采用所属来源；创建普通知识不构建全局图，Problem 创建仍绑定治理政策。关系变更、删除和 fixed 需要完整反向关系或证明时可以扩大依赖，必须明确。show 保留既有关系输出，属于关系查询；index/recall 提供知识读取。

publication 与 runner 是不同资源。publication 的死 token 由 recover 显式回收，不按年龄抢占；普通 acquire 返回准确诊断，不删除未知状态。runner 无法证明已清理时，普通观察仍可用，发布继续拒绝，因为消费者命令可能写任意路径。

recover 输出保持 operation 和 changedPaths，增加协调回收事实及 runner 诊断。无 journal 但 runner 阻塞返回 blocked；journal 已恢复且 runner 阻塞也不得报全局 clean。活 publication owner 与冲突 journal 仍具名失败。结果描述检查时状态，不承诺后续没有新并发者。

来源读取返回前核验观察集合与发布代次，不持 publication owner。普通写入的规划采用乐观快照，提交独占；runner 与恢复的状态转换保留显式写快照。当前协调契约见[功能架构](../../../feature/portable-coordination/architecture.md)。
