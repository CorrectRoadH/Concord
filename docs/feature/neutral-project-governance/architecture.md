# 治理边界

## 所有权

Concord 拥有 canonical Spec、声明注释与测试支持文件映射、稳定身份派生、trace、回归关系与历史、Memory 生命周期、证据 schema、证据要求和最终 fixed 判定。CLI、Web、action 与 `concord repo` 共用同一权威实现；入口和存储适配可以不同，生命周期与证据不变量只有一个解释。

消费者拥有原生 collection、执行副本、候选产品的构建与安装、原生 runner 的结果观察与进程 Scope，以及产品命令、Preview、示例同步、文档站与 PR 编辑格式。Concord 的 `review render` 保留 Spec、测试、Memory 与证据的审阅能力。依据：产品工具归消费者、治理归 Concord（[决策依据](../../design/neutral-project-governance/DECISION.md)）。

## 证据核验

regression add/refresh 与 fixed 共用唯一的 `validateNativeEvidence`，按[证据要求](../../repository-profile.md#证据要求)核验。red 是目标回归的普通失败；原生 inventory 没有发现错误，没有执行测试 body 或禁止的 setup。八个 invocation 唯一；inventory、source、runner 与配置身份一致。执行副本记录支持 isolated 互异与 same 一致的判定，文件名和收据数量不能单独证明隔离；全部事实绑定当前 open Problem 的 epoch。

Problem 在创建、activate、reopen 或离线迁移时持久化当前 epoch 的最低要求。政策版本、配置原文摘要与 adapter 实现身份进入新证据的身份绑定，并参与发布前像检查。adapter 是受信任的本地代码：Concord 严格解码其输入并核验事实，不接受单独的 passed/verified 布尔值；完整性摘要不防御能修改本地文件的作者。

## 离线切换

配置、包依赖、旧入口、最低证据要求与私有协调路径只在明确的停写窗口内切换。切换持有旧、新 exclusive 锁，先拒绝活跃 writer 与未完成 journal，不删除锁文件来解除占用；旧程序退出并切换入口，不让两把锁各自保护同一 owner。切换保存完整前像与可恢复现场，未知修改拒绝覆盖。普通运行拒绝旧格式现场并保留原件（[C-009](../../constitution.md#c-009-1)）。回滚包含消费仓库的依赖、入口与 Git-private 状态。

## Trace 报告模式

Trace 编译有严格与报告两种模式。报告模式返回 `{ snapshot, complete, findings }`，只隔离[可归因到单个测试源码文件](use-case/compose-repository-workflows.md#容错只读查询)的错误。snapshot digest 按剩余内容计算，只用于展示，不作为写入前像。依赖完整关系图的写入经过 `requireCompleteTrace`：报告模式存在 finding 即失败；通过后在同一 lease 内以严格模式编译并取得前像。只修改自身 owner 的写入在报告模式 snapshot 上校验被引用的 Markdown owner，前像取自被写 owner 自身的字节；基础 CLI 的本地 Issue 写入不编译 Trace。

## 远端 Issue 写入

- receipt 写入 Git-private `concord/issue-plan/v1/planned/<receipt-id>.json`（mode 0600），记录 connection ID 与 repositoryId。execute 消费后写 `consumed/<receipt-id>.outcome.json`（mode 0600），不含凭据或响应正文。
- 每个已消费 receipt 恰有一个 outcome：`applied`、`drifted`、`aborted`（写请求前失败，`code` 记录具名错误）、`rejected`（`status` 记录 HTTP 状态）或 `uncertain`；只有 `uncertain` 表示远端可能已改变。outcome 写入失败不改变命令返回的错误。receipt store 防止误用与并发重放，不防御能直接改写 Git-private 目录的本地进程。
- gh 调用沿用 Feedback gh 读取的可信可执行文件、环境裁剪与进程组回收（[接入 Spec](../feedback/cli-integration.md#接入与信任-spec)）。写请求的 JSON 正文只经 stdin 传给 `gh api --input -`，不使用 `-f`、`-F`、`--field` 或 `--raw-field`，因为 `-F` 会把以 `@` 开头的值当作本地文件读取。
- 写方法只在 execute 路径开放，路径限定为 `repos/<owner>/<repo>/issues...`。请求为 `POST issues`、`POST issues/<n>/labels`、`DELETE issues/<n>/labels/<name>`、`POST issues/<n>/comments` 与 `PATCH issues/<n>`。PATCH 时 body-set 只带 `body`，close 只带 `state: "closed"` 与可选 `state_reason`，reopen 只带 `state: "open"`。路径段经 `encodeURIComponent` 编码。

## Docs Work

run 写入 Git-private `concord/docs-work/v1/<run-id>/`，包含 `run.json`、`receipts/<item>.reported.json`、`receipts/<item>.verified.json` 与 `finalize.json`。`run.json` 的格式为 `concord.docs-work-run/v1`，含 runId、baseCommit、createdAt、configDigest、sharedPaths、展开后的 items 与 prepare 时的 readDigest。

run-id 默认由 Clock 时间与随机后缀生成。同一 run 的写操作持有 run 目录内的独占文件锁，文件经临时文件、fsync 与 rename 原子替换；中断只留下 `.tmp-` 临时文件，下次持锁时删除。检查子进程超时或取消时回收进程组。

## 命令贡献

贡献是 `RepositoryCommandContribution<Name, R>`：`name`、`summary` 与 `makeCommand(deliver)`。`R` 声明所需服务，宿主在组合边缘提供对应 Node 层；`repository/cli-support.ts` 提供共享的输入、输出与错误渲染。宿主不组合本地 Issue 写命令，直接调用 `concord issue`。

## Repository adapter

1. Concord 读取配置，校验 adapter 路径与环境名，捕获 engine、配置与实现文件摘要；关闭来源快照后在 Effect Scope 内创建唯一的 detached POSIX 进程组，写入请求并关闭 stdin。adapter 在入口验证自己是请求中 `leaderPid` 的组 leader。
2. engine 子调用、安装与原生 collection 子进程继承该组，不创建独立组；engine 不反向调用 adapter。子任务失败或超时后 adapter 失败退出，整组由外层 Scope 终结。
3. Concord 确认进程组终结后才解码响应并核对回显与前后摘要。正常结束后仍有组成员即拒绝成功；取消、超时与输出超限同样执行 TERM、grace、KILL 并核验。清理不明时保留现场，不签发有效证据，拒绝后续能力调用。容器等组外资源由原生 receipt 的资源终结记录负责。

所有 read 能力在取得 publication lease 前执行。Concord 立即核对 guards 中每个文件的 SHA-256；read-red 与 read-takeover 的 candidatePath 必须在 guards 中，摘要等于 receipt 的 `candidate.sha256`。锁外把解码结果、候选摘要、guards 与本地 implementationDigest 组成只读捕获并运行 validator。锁内只重验 guard 字节、本地身份、当前源码与配置、Memory epoch、已用 invocation 与发布前像，再把同一捕获交给同一 validator，不启动子进程。任何变化返回 `PreimageChanged`，不重签、不自动重试。

`managedInventoryImplementationDigest` 由 Concord 本地计算，绑定 engine、配置原文、adapter argv、实现文件路径与字节、执行文件的 realpath 与字节及运行时版本；adapterSourceDigest 绑定同一集合。implementationRoots 递归枚举普通文件，排除 `node_modules` 与 `.git`，拒绝 symlink、特殊文件与空根；增删文件都改变摘要。安装后的依赖由 frozen lockfile 与包管理器完整性负责。

engine 路由只组合已有的 schema、签名、source identity 与声明解析实现；sign 不接受 managed ID、不写文件、不发布，validate 不重签坏签名。没有新的证据数据库。模块 host 保留原有能力路径，进程模式不在持锁期间回调。依据：Concord 独占治理算法与最终证据门（[决策依据](../../design/repository-process-adapter/DECISION.md)）。
