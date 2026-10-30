# 治理边界

## 所有权

Concord 拥有路径身份推导、源码标记与测试支持文件映射、稳定 case 身份派生、trace、Issue 与 Memory 的字段与状态转换校验、[修复核验](../../constitution.md#c-004-2)，以及 `check --since <base>` 门禁。CLI、Web 与 action 共用同一实现；入口和存储适配可以不同，生命周期与核验不变量只有一个解释。

消费者拥有测试 runner、执行环境、候选产品的构建与安装，以及产品命令、Preview、示例同步、文档站与 PR 编辑格式。Concord 只通过配置的 runner 运行测试，按退出码解释结果，不签发原生 case 覆盖或正式可靠性结论（[决策依据](../../design/sdd-core-model/DECISION.md)）。Concord 的 `review render` 保留 Spec、测试、Issue 与 Memory 的审阅能力。依据：产品工具归消费者、治理归 Concord（[决策依据](../../design/neutral-project-governance/DECISION.md)）。

## 离线切换

配置、包依赖、入口与私有协调路径只在明确的停写窗口内切换。切换持有旧、新 exclusive 锁，先拒绝活跃 writer 与未完成 journal，不删除锁文件来解除占用；旧程序退出并切换入口，不让两把锁各自保护同一 owner。切换保存完整前像与可恢复现场，未知修改拒绝覆盖。普通运行拒绝旧格式现场并保留原件（[C-009](../../constitution.md#c-009-1)）。回滚包含消费仓库的依赖、入口与 Git-private 状态。

## Trace 报告模式

Trace 编译有严格与报告两种模式。报告模式返回 `{ snapshot, complete, findings }`，只隔离[可归因到单个测试源码文件](use-case/compose-repository-workflows.md#容错只读查询)的错误。snapshot digest 按剩余内容计算，只用于展示，不作为写入前像。依赖完整关系图的写入经过 `requireCompleteTrace`：报告模式存在 finding 即失败；通过后在同一 lease 内以严格模式编译并取得前像。只修改自身 owner 的写入在报告模式 snapshot 上校验被引用的 Markdown owner，前像取自被写 owner 自身的字节。

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
