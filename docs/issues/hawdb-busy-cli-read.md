# CLI 读命令把短暂的 HawdbBusy 直接返回给调用者

多个 agent 在同一 worktree 并行运行 Concord 时，只读命令可能直接以 `HawdbBusy` 失败。2026-10-29 实测：`pnpm concord trace show` 第一次返回 HawdbBusy，立即重试通过。

现状对照：Web 工作台的 HTTP 缓存读取遇到 HawdbBusy 时有界重试 500 ms，`src/application.ts` 的文件读取也循环重试；后台刷新进程在期限内重试（`src/query-refresh-worker.ts`）。CLI 只读命令没有对应的有界等待，也没有 Spec 说明调用者应如何处理。

待决定：CLI 只读命令是否像 HTTP 读取一样在短期限内自动重试，或在 CLI Spec 中声明 HawdbBusy 为可重试错误并在 skill 中给出处理方式。相关方案：CLI 热路径 的 G5。
