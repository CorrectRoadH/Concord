# 治理边界

## 所有权

Concord 拥有路径身份推导、源码标记与测试支持文件映射、稳定 case 身份派生、trace、Issue 与 Memory 的字段与状态转换校验与原生用例收集/绑定。CLI、Web 与 action 共用同一实现；入口和存储适配可以不同，生命周期与静态检查不变量只有一个解释。

接入项目拥有测试 runner、执行环境、候选产品的构建与安装，以及产品命令、Preview、示例同步、文档站与 PR 编辑格式。Concord 只收集用例与 label、派生绑定；测试执行与结果解释由 agent 负责，不签发测试通过或覆盖结论。Concord 的 `review` 保留 Spec、测试、Issue 与 Memory 的审阅能力。依据：产品工具归接入项目、治理归 Concord。

## 升级

Concord 只读写[当前格式](../../architecture.md#当前格式)，不提供迁移或切换命令。协议变化时，新版本客户端自动停止该 worktree 中旧版本的工作区服务并启动当前版本服务。服务启动时对陈旧格式的缓存与投影直接丢弃重建，对陈旧或冲突的 `journal.json` 以磁盘当前文件为准自动清理并输出告警，不锁死仓库。

## 关系编译

关系编译只有一个实现，基于工作区服务的内存增量工作区图执行，完整性与 finding 的规则见 [local SDLC 架构](../local-sdlc/architecture.md#操作依赖)。

## 远端 Issue 写入

- 远端写入在工作区服务单内核中协调：预览（`remote preview`）生成计划与摘要，执行（`remote apply`）核对计划摘要后发起请求，不再在 Git-private 目录下维护多阶段文件队列。
- gh 调用沿用 Feedback gh 读取的可信可执行文件、环境裁剪与进程组回收（[接入 Spec](../feedback/architecture.md#接入与信任约束)）。写请求的 JSON 正文只经 stdin 传给 `gh api --input -`，不使用 `-f`、`-F`、`--field` 或 `--raw-field`，因为 `-F` 会把以 `@` 开头的值当作本地文件读取。
- 写方法只在 execute 路径开放，路径限定为 `repos/<owner>/<repo>/issues...`。请求为 `POST issues`、`POST issues/<n>/labels`、`DELETE issues/<n>/labels/<name>`、`POST issues/<n>/comments` 与 `PATCH issues/<n>`。PATCH 时 body-set 只带 `body`，close 只带 `state: "closed"` 与可选 `state_reason`，reopen 只带 `state: "open"`。路径段经 `encodeURIComponent` 编码。

## Docs Work

`docs work` 的运行状态保存在 Git-private `concord/docs-work/v1/<run-id>/`，由工作区服务的写互斥协调原子更新，不再单独维护目录级文件锁。检查直接调用 Concord 自身的静态规则，不创建外部检查进程或运行项目命令。

## 命令入口

Concord 的工作流由 `concord` bin 提供。接入项目以进程调用这些命令，领域操作与入口适配由 Concord 拥有，不向宿主导出命令贡献。
