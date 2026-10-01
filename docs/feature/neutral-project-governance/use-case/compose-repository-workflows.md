---
format: concord.document/v1
id: compose-repository-workflows
title: 组合仓库工作流命令
createdAt: 2026-10-01T04:04:37.083Z
kind: use-case
feature: docs/feature/neutral-project-governance/README.md
---

# 组合仓库工作流命令

## 用户目标

消费项目的宿主 CLI 组合 Concord 的 Feedback、Memory、Docs 与 Issue 远端写入命令，不复制命令定义；共享工作树上某个 Agent 未完成的测试文件不阻断其它 Agent 的只读查询。

## 完整路径

1. 宿主从 `concord-sdlc/repository/*` 导入 `feedbackCliContribution`、`memoryCliContribution`、Docs 贡献与 `runComposedCli`。宿主按自己的顺序挂载，并提供 `FeedbackStore` 与 `MemoryStore` 的 Node 层。
2. 用户运行 `<host> memory check`、`<host> docs feature list` 等命令；verbs、options 与 `--help` 与 `concord repo` 相同。
3. 某个 suite 文件写了 `// @feature docs/feature/adapters/library.md`。list 与 show 返回其余结果，JSON 带 `complete: false` 与 finding。finding 说明 `@feature` 必须指向 Feature package README 或改用 `@use-case`，并建议 `docs/feature/adapters/README.md`。
4. check 类命令把 finding 列入 `incomplete` 并退出 1。Memory fixed 解决、regression 与 case 关系写入以 `TraceIncomplete` 拒绝，零写入。memory create、本地 Issue 写入等不消费 case 关系的写入照常完成。
5. 输入未知子命令时只输出一条 `UnknownSubcommand` 错误并退出 1；带 `--json` 时输出一行 `{ ok: false, error, message, details }`。

## 结果

- 单文件标记错误只影响该文件的 case，其它 owner 的关系照常返回。跨文件 caseId 重复时，所有声明该 caseId 的文件都被排除，结果与枚举顺序无关。
- list/show 在 `complete: false` 时退出 0，消费者读取 JSON `complete` 判断完整性。
- Markdown owner、Memory、Issue 自身的格式错误仍使编译失败。
- 宿主不维护 Feedback、Memory 的 option 定义。

## 契约来源

- [仓库工作流架构](../../../design/repository-workflows/plans/main-cli-owned/architecture.md#trace-容错编译)
- [命令贡献与组合](../../../design/repository-workflows/plans/main-cli-owned/architecture.md#命令贡献与组合)
- [公开输出契约](../../../design/repository-workflows/plans/main-cli-owned/architecture.md#公开输出契约)
- [高级测试治理](../../../repository-profile.md)
