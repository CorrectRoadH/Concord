---
name: concord
description: 在本地 Git 仓库中使用 Concord 维护产品契约、代码归属、测试注释与命令证据、工程 Memory、追踪关系和恢复流程；需要操作 Concord 文档或解释通用模式与 repository profile 边界时使用。
---

# Concord

Concord 把 Markdown 契约、测试声明旁的注释和工程 Memory 留在各自 owner 中，再动态推导关系。先遵守消费仓库的 `AGENTS.md`，并用对应命令的 `--help` 核对当前参数。脚本和 Agent 优先使用 `--json`；跨目录操作时显式传 `--root <worktree>`。

只在任务授权范围内执行写命令。`check`、`trace` 或命令收据不等于原生测试覆盖率，也不证明 NiceEval formal E2E 可靠性；提交、push、发布、部署和远端消息仍需独立授权。

## 按需读取

- 首次接入、runner 配置或模板：运行 `concord --skill init`。
- Feature、Use Case、Research、Design、Roadmap、Engineering 与正文更新：运行 `concord --skill document`。
- 整文件、函数和代码段的实现关联与位置查询：运行 `concord --skill code`。
- 测试注释、执行和 command evidence：运行 `concord --skill test`。
- Problem、Decision、Insight 与生命周期：运行 `concord --skill memory`。
- 关系检查、审阅材料与交接：运行 `concord --skill trace`。
- cache 或中断写入恢复：运行 `concord --skill recovery`。
- `concord repo` 与通用模式差异：运行 `concord --skill repository`。
- 只有确实需要完整离线资料时才运行 `concord --skill all`。

## 工作原则

先读取现有 owner 与关系，再决定应修改契约、测试源码还是 Memory。路径是 canonical identity；不要另建反向登记表或测试关系 JSON。文档变更先用 `--dry-run` 检查时，仍须以实际非 dry-run 结果作为完成依据。任何冲突、恢复要求或证据陈旧都应保留现场并处理具名错误，不得绕过 guard。
