# 中立治理边界（已采用）

## 所有权

Concord 拥有 canonical 契约、声明注释/helper 映射、稳定身份派生、trace、回归关系与历史、Memory 生命周期、证据 schema、证据要求和最终 fixed 判定。CLI 与 Web 共用权威投影；入口和存储适配可以不同，生命周期及证据不变量只能有一个解释。

消费者拥有 native collection、执行副本、候选产品构建安装、原生 runner 结果观察与进程 Scope。NiceEval 的 Preview、下游链接、示例同步、仓库 setup、Mint 文档站、产品 reference/diff/generators、具体术语和 work 检查、PR 编辑格式移回 NiceEval。Concord 的本地 `review render` 保留契约、测试、Memory 和证据的审阅能力。

## 中立配置与发现

`concord.repository.json` 新当前格式 `concord.repository/v2` 拥有：

- `suites`：非空 `{ id, root }` 数组；ID 唯一，root 是安全 canonical 仓库相对目录，不重叠。
- `historyPath`：安全 canonical 测试关系归档路径，位于套件目录之外且必须显式声明；没有产品默认目录。
- `policy`：首版仅 `concord.native-reliability/v1`。这是明确采用的治理标准，不是所有测试项目都必须实现的 runner 接口。
- `host`：可选 canonical 本地模块路径；只有实际请求原生能力时加载。

同一配置供静态 discovery、source projection、regression/fixed、trace 和 Web 使用。不读取 Nx、固定 `e2e/` 或 `targets.e2e.metadata.niceeval`。源码注释唯一拥有 current 测试关系，配置不重复登记 case。通用投影不要求 executor/lanes/host/provider。

基础项目采用 command evidence；高级项目显式采用可靠原生证据要求。软件项目尚未接某项执行能力时仍能查询契约和关联，缺少能力时只对请求该能力的命令返回具名失败。help、静态查询及 Web 不执行 host。

## 能力与信任

host 只声明中立 inventory、red/takeover 读取等必要能力，不携带产品 QUERY_PROTOCOL 或复制消费者的 runner 类型图。可分别提供能力；Concord 逐能力校验，不以缺少其它能力拒绝静态接入。

本地作者维护的 adapter 是可信执行代码，Concord 对输入严格解码并校验事实；不接受一个裸 passed/verified 布尔值替代证据。adapter 负责原生唯一绑定、真实副本、执行观察及取消清理；Concord 拥有最终核验与发布。完整性摘要不声称防御恶意本地作者。

## 证据要求

项目要求是下限。Problem 在创建、activate、reopen 或离线迁移时持久化其当前 epoch 的最低要求；历史 repository resolution 及已采用的高要求不能因删除配置消失。本轮不提供降级入口。CLI、Web、action 和 repo 在 fixed 写入前使用同一政策检查，command 证据不能关闭要求 native-reliability 的 Problem。

政策版本、配置原文摘要、adapter 实现身份进入新证据的当前身份绑定，并参加发布前像检查。旧证据不补字段或重签，只可作为历史原件；旧 repository resolution、epoch、已使用 invocation 的记录保留，不能用于新 fixed。

Concord 的权威 validator 由 regression add/refresh 与 fixed 共用：

1. 原生 inventory 无发现错误、无测试 body/禁止 setup 执行；目标 case 与源码声明唯一绑定。
2. red 是目标回归的普通失败，green 是真实非零 case 的通过；拒绝 timeout、signal、启动失败、zero、skip、retry 和 cleanup 失败。
3. 除单项 green 外，要求三份隔离副本、同副本连续两次、默认并行观察；全部七次 green/reliability 观察有 cleanup 记录。
4. 八个 invocation 唯一；inventory、source、runner 与配置身份一致；green 和六次可靠性观察属于同一修复候选，red 属于实际缺陷候选，允许与 green 不同，执行副本记录支持 isolated 互异与 same 一致的判定。文件名和收据数量不能单独证明隔离。
5. 所有事实绑定当前 open Problem 的 epoch，重开后旧 invocation 不能再次使用。

## 离线切换

配置、包依赖、旧入口、最低证据要求和私有协调路径在明确停写窗口内切换。迁移持旧、新 exclusive flock，先拒绝活跃 writer 和未完成 journal；不删除锁文件来解除占用。普通运行拒绝旧现场；旧程序也必须退出并切换入口，不能让两把锁各自保护同一 owner。

迁移计划保存完整前像和可恢复现场；未知修改拒绝覆盖，中断保持可解释状态。旧证据原件和历史 invocation 保留。回滚包含消费仓库依赖/入口和 Git-private 状态，而不只撤销 Concord 源码。

## 有限真实验收

- 非 NiceEval、非 Nx、非 e2e 目录的隔离 Git 软件项目，通过打包 CLI 完成真实 native red→green→完整可靠性矩阵→fixed→reopen→旧 invocation 拒绝。
- 验证 command 降级绕过、配置和源码漂移、取消清理、迁移中断/冲突/恢复。
- 加载即失败的 host 不影响 help、静态 trace、Web；缺能力仅阻断对应命令。
- NiceEval 在指定 worktree 使用新配置/包/协议与真实 runner，执行一套无付费、无远端副作用的正式闭环；不扩大成全量产品矩阵。
- `pnpm check` 通过，原有 Web 编辑保留。历史或来源声明不冒充当前验收。
