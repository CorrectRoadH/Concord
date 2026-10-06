# Cases

| Case ID | User Problem | Fixed Input | Acceptance Result |
|---|---|---|---|
| C1 | 冷缓存仓库在扫描期间被编辑 | 无投影；后台写者在整个刷新扫描期间每隔几毫秒改写一个已观察文件，分别取 docs 文件、测试文件与代码文件三种情形 | 刷新结束后 `trace gaps --json` 退出码 0，`projection.consistent` 为 false，`changedPaths` 含该文件，`unknownRelations` 为 true；代码来源不稳定时 `unknown` 为 `['code']`；人类输出提示结果可能不完整 |
| C2 | 已有一致投影的仓库在下一次刷新中被编辑 | 已有 consistent 投影；新扫描期间改写来源 | 继续服务原 consistent 投影；`projection.lastAttempt` 记录时间、`consistent: false` 与变化路径；不写 error |
| C3 | 刷新扫描超时 | 扫描耗时超过刷新上限 | 记录 `error.code` 为 `QueryRefreshTimedOut`，含 `elapsedMs` 与 `limitMs`；已有投影仍可读；无投影时 QueryPending 的 `details.refresh` 给出同一错误 |
| C4 | 扫描以具名错误失败 | 扫描进程输出 `{"format":"concord.query-scan/v1","ok":false,"code":"InvalidConfig",...}`，或扫描内存在非漂移 finding | 记录保留原错误码与消息，不压成 `QueryRefreshFailed`；非漂移 finding 记为 `TraceInvalid`；`RecoveryRequired` 不发布投影 |
| C5 | 同一编辑同时影响工作台与 CLI | 同一 worktree，工作区投影与 trace gaps 投影都在漂移下构建 | 两者的 `consistent`、`complete`、`changedPaths`、`unknownRelations`、lastAttempt 与替换规则一致；`builtAt` 不参与比较 |
| C6 | 配置或安装身份在扫描期间变化 | 扫描期间改写 `concord.config.ts` | 候选丢弃，不发布、不记为失败，按新身份重新请求刷新 |
| C7 | trace show 与 review render 需要正文 | 投影建成后 owner 正文被修改 | 持久 payload 不含 owner 正文与远端 Issue 正文；摘要未变时输出与同源 `--fresh` 字节相同；摘要变化时省略该正文并在 `projection.bodyChanged` 列出路径 |
