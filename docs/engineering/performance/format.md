# 预算表与场景

预算数字只在 Feature 的 `performance.md` 中声明，测量步骤只在 `bench/<feature-id>.bench.ts` 中声明，二者以场景 ID 对应，不另存预算清单（[一件事只写一次，其余推导](../../taste.md#t-3)）。

## 预算表

每个拥有高频公开操作的 Feature 在 `docs/feature/<f>/performance.md` 的 `## 性能预算`（按 warm p50 判定）或 `## 刷新上限`（按最大值判定）标题下写一张 Markdown 表：

- 首列以行内代码列出一个或多个场景 ID，同一行的场景共用该阈值。
- 中间列用文字说明测量内容。
- 末列为 `<整数>ms`。

```markdown
## 性能预算

| 场景 | 测量内容 | p50 预算 |
| --- | --- | ---: |
| `local-data-engine/trace-gaps-warm`、`local-data-engine/review-warm` | 已有投影时读取关系缺口与审阅材料 | 600ms |
```

测量工具只扫描 `docs/feature/*/performance.md` 派生预算行，不维护 owner 列表。README、Use Case 与 Engineering 页面中的数字不是预算；它们链接对应的 `performance.md`。理解阈值所需的参照消费者、参照环境与负载前提写在同一页。

场景 ID 的格式为 `<feature-id>/<名称>`，`feature-id` 必须是该 `performance.md` 所属的 Feature。

场景引用的 owner 不存在于所测消费者时，该场景在记录中标为 `skipped` 并写明原因，不参与通过判定。`self` 消费者上出现 `skipped`，视为场景或预算表失效，判失败。

## 基准场景

每个拥有预算行的 Feature 在 `bench/<feature-id>.bench.ts` 中用严格 TypeScript 与 Effect 定义自己的基准场景，文件默认导出 `defineBenchmarks(featureId, scenarios)`。场景是可执行的测量定义，由源码拥有；它不带 `@feature` 测试标记，不计入测试覆盖，也不证明行为正确。

| 字段 | 含义 |
| --- | --- |
| `id` | 场景 ID，在全仓唯一，必须被恰好一个预算行引用 |
| `consumer` | `self`、`scale` 或 `fixture:<名称>`；fixture 由 `bench/fixtures/` 下的生成函数通过公开 CLI 建立并提交冻结 |
| `state` | `warm` 或 `cold`，见下文 |
| `prepare` | 每个产物采样前执行一次的准备步骤，不计时 |
| `beforeEach` | 每次采样前执行的步骤（例如修改 k 个文件），不计时；结束后消费者必须可以恢复到冻结状态 |
| `run` | 计时的操作，形式见下文 |
| `expect` | 期望的退出码，以及可选的 `--json` 输出 Schema；不符即该样本失败 |

`state` 的两个取值：

- `warm`：采样前执行一次同一场景，并确认缓存 `ready`。
- `cold`：每次采样前执行 `concord cache clear`。

`run` 有四种形式，都只计时这一步，`prepare` 与 `beforeEach` 不计时：

- Concord argv：计 `run` 进程从启动到退出的 wall time。
- `{ argv, concurrency }`：同时启动 n 个进程，计时到全部退出。
- `{ request }`：对 `prepare` 启动的 view 服务发出一次 HTTP 请求，计时从请求发出到响应体读完。
- `{ scan }`：刷新上限场景使用，见下文。

场景只能通过公开 CLI 与文件系统操作消费者，不导入 `src/` 内部模块。

刷新上限场景以 `{ scan }` 形式运行安装目录内的扫描入口 `query-scan-worker.js <root> <query-json>`，即后台刷新进程实际执行的扫描，按最大值对照上限。

读取异步投影的 `warm` 场景在采样前等待投影发布，等待不超过刷新上限加 30 秒。等不到投影时测量失败，记录最后一次输出的 `QueryPending` 及 `refresh` 详情。

## 覆盖规则

`pnpm gate` 的 Node 测试包含三项不计时的检查，保证预算与场景同步，场景不会失效：

1. 一致性：每个预算行引用的场景都存在；每个场景恰好被一个预算行引用，且场景 ID 的 Feature 与该行所在 `performance.md` 的 Feature 一致；场景文件名与其 `featureId` 一致。
2. 命令覆盖：CLI 定义中的每个顶层命令组至少出现在一个场景的 `run` 中，或列在下方豁免表中。新增命令组必须在同一改动中补充场景与预算行，或补充豁免理由。
3. 冒烟：每个场景在其最小消费者上执行一次（`fixture` 优先，`self` 与 `scale` 换成同形的小规模 fixture），检查 `expect`，不判定耗时。冒烟目标不超过 30 秒，由完整门禁的耗时记录观察；测试时限只用于发现挂起。

| 豁免的命令组 | 理由 |
| --- | --- |
| `init` | 每个仓库只执行一次 |
| `recover` | 只在异常中断后执行 |
| `feedback sync`、`feedback import` | 耗时由远端决定；本地部分由 `feedback list` 场景覆盖 |
| `test run`、`test verify`、`docs work` | 耗时由被执行的 runner 与检查决定 |
| `view` | 长期运行的服务，请求耗时由 `web-workbench` 场景测量 |
| `lsp` | 长期运行的编辑器服务 |
| `new`、`roadmap` | 创建文档与采用 Roadmap 是低频写入，耗时由模板与前像核验决定 |
| `show` | 与 `trace show` 读取同一份文档与关系，由 `local-sdlc/trace-show-fresh` 覆盖 |
| `use-case` | 步骤查看与改写是低频操作，解析路径与 `docs check` 相同 |
| `skills` | 安装工作流 skill 是低频写入 |
| `writing` | 写作规则的查看与受管写入是低频操作，解析路径与 `docs check` 相同 |
| `herdr-mod` | Herdr 中的原生界面，通过公开 CLI 读取，见 [Concord mod](../../feature/herdr-mod/README.md) |
| `server` | 工作区服务的启动、停止与状态控制；经由服务的请求耗时由声明 `server: running` 的查询场景与面板场景测量 |
