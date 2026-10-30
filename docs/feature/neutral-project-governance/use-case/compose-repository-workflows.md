---
format: concord.document/v1
id: compose-repository-workflows
title: 组合仓库工作流命令
kind: use-case
feature: docs/feature/neutral-project-governance/README.md
---

# 组合仓库工作流命令

## 用户目标

消费项目的宿主 CLI 组合 Concord 的 Feedback、Memory、Docs 与 Issue 远端写入命令，不复制命令定义；共享工作树上某个 Agent 未完成的测试文件不阻断其它 Agent 的只读查询。

## 完整路径

1. 宿主从 `concord-sdlc/repository/*` 导入命令贡献与 `runComposedCli`。贡献包括 `feedbackCliContribution`、`memoryCliContribution`、`docsWorkCommandContribution` 与 `issueRemoteCommandContribution`。宿主按自己的顺序挂载，并在组合边缘提供各贡献在类型中声明的服务（如 `FeedbackStore`、`MemoryStore`）。`concord repo` 组合同一份贡献。
2. 用户运行 `<host> memory check`、`<host> docs feature list` 等命令；verbs、options 与 `--help` 与 `concord repo` 相同。
3. 某个 suite 文件写了 `// @feature docs/feature/adapters/library.md`。list 与 show 返回其余结果与该文件的 finding，建议 `docs/feature/adapters/README.md`；check 退出 1；依赖完整关系图的写入零写入失败，其它写入照常完成。
4. 输入未知子命令时只输出一条 `UnknownSubcommand` 错误并退出 1。

## 容错只读查询

只能归因到单个测试源码文件的错误记为该文件的 finding，该文件的全部 case 从结果中排除，不保留半个文件。这类错误包括标记格式错误、`@test-file` 指向的文件不存在、contract 目标无效或类型不符、suite 归属错误、`@regression` 目标不存在或不是 Problem Memory、caseId 与 case history 的 tombstone 冲突。同一 caseId 由多个文件声明时，这些文件都记 `CaseIdConflict` 并全部排除，结果与枚举顺序无关。Markdown owner、Memory、Issue、case history 自身与跨 owner 关系的错误仍使命令失败。

finding 形如 `{ code, path, subject, message, suggestion?, conflictsWith? }`，代码为 `CaseAnnotationInvalid`、`CaseContractInvalid`、`CaseSuiteInvalid`、`CaseRegressionInvalid`、`CaseIdConflict`；`conflictsWith` 按路径排序列出其它文件。标记文案：

- `@feature must target a Feature package README (docs/feature/<package>/README.md); use @use-case for a leaf Use Case`。目标位于 Feature 包内时建议该包的 README；目标在 `use-case/` 下时建议 `@use-case <原路径>`。
- `@use-case must target a leaf Use Case (docs/feature/<package>/use-case/<name>.md)`；目标是 Feature README 时建议改用 `@feature`。

报告模式覆盖 design、research、use-case 的只读子命令与 `docs trace`。它还覆盖 `docs feature list/show`、`docs test list/show`、`memory list/show/search/check` 与 `feedback list/show/export/check`。

- JSON 结果增加 `complete: boolean` 与 `findings`；人读输出把每条 finding 以 `warning: <path>: <message>` 写到 stderr。
- list/show 在 `complete: false` 时退出 0，消费者读 JSON `complete` 判断完整性。show 的目标 case 位于被排除文件时返回 `CaseExcluded`（附该文件的 finding）并退出 1。
- check 类命令输出 `ok`、`complete`、`violations`（被检 owner 自身的违规）与 `incomplete`（finding），有任一项即退出 1（[C-010](../../../constitution.md#c-010-3)）。

## 写入与完整关系图

| 类别 | 命令 | finding 的影响 |
| --- | --- | --- |
| 依赖完整关系图 | `memory resolve` fixed、regression add/refresh/retire、case issue add/retire；删除、退役、取代或改名可能被测试标记引用的 Memory、Feature 或 Use Case；`trace recover` 后的复核 | 返回 `TraceIncomplete`（`details.findings` 列出全部 finding），零写入；不可隔离的错误保留原错误码（如 `TraceFormatError`） |
| 只新增或修改自身 owner | memory create/edit、Issue 写入、`repo feedback import`、Feature page add/set、design/research/use-case 创建 | 不因测试源码 finding 拒绝；自身与被引用的 owner 仍严格校验 |

第二类写入不消费 case 关系，也不能使已有测试标记失去目标（[C-013](../../../constitution.md#c-013-1)）。

## 组合 CLI 的输出

- 未知子命令只向 stderr 输出 `UnknownSubcommand: "<name>" for "<parent>"; run <parent> --help`，退出 1，不打印 help；`details` 为 `{ name, parent }`。解析错误同样只输出一条 `InvalidInput`。
- `--help` 或只输入命令组名时向 stdout 打印该组 help 并退出 0。
- 参数含 `--json` 时，任何失败都向 stderr 输出一行 `{ "ok": false, "error": <code>, "message": <text>, "details"?: <object> }` 并退出 1，与基础 CLI 的错误形状相同。领域错误的 `error` 取其具名代码；未声明的异常为 `RepositoryToolError`，消息不含凭据与环境变量值（[C-007](../../../constitution.md#c-007-4)）。

## 验收

在打包后公开 CLI 与隔离 Git 消费者中：

- 一个坏 `@feature` 文件不影响 list/show；check 退出 1 并列出 finding；fixed 与关系写入以 `TraceIncomplete` 零写入失败，memory create 与 Issue close 仍成功；文案与 suggestion 正确。
- caseId 与 tombstone 冲突时只排除该文件。
- 公开输入无法让两个不同声明文件得到同一 caseId；`CaseIdConflict` 的对称排除用真实解码后的 case 输入做领域测试，不声称公开 CLI 覆盖。
- 最小宿主组合 `feedbackCliContribution`、`memoryCliContribution` 与 `runComposedCli`，help、命令组名与未知子命令（带与不带 `--json`）的输出符合上节。

编译模式与前像规则见[架构](../architecture.md#trace-报告模式)。

## Spec 来源

- [高级测试治理](../../../repository-profile.md)
- [决策依据](../../../design/repository-workflows/DECISION.md)
