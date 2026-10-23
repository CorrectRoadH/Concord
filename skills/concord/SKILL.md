---
name: concord
description: 在本地 Git 仓库中使用 Concord 维护产品契约、代码归属、测试注释与命令证据、工程 Memory、追踪关系和恢复流程；需要操作 Concord 文档或解释command 证据与高级原生治理边界时使用。
---

# Concord

Concord 把 Markdown 契约、测试源码里的 Concord 标记和工程 Memory 留在各自 owner 中，再动态推导关系。先遵守消费仓库的 `AGENTS.md`，并用对应命令的 `--help` 核对当前参数。脚本和 Agent 优先使用 `--json`；跨目录操作时显式传 `--root <worktree>`。

只在任务授权范围内执行写命令。`check`、`trace` 或命令收据不等于原生测试覆盖率，也不证明 原生 E2E 可靠性；提交、push、发布、部署和远端消息仍需独立授权。

## 按需读取

- 首次接入、runner 配置或模板：运行 `concord --skill init`。
- Feature、Use Case、Research、Design、Roadmap、Engineering 与正文更新：运行 `concord --skill document`。
- 整文件、函数和代码段的实现关联与位置查询：运行 `concord --skill code`。
- 测试注释、执行和 command evidence：运行 `concord --skill test`。
- Problem、Decision、Insight 与生命周期：运行 `concord --skill memory`。
- 关系检查、审阅材料与交接：运行 `concord --skill trace`。
- cache 或中断写入恢复：运行 `concord --skill recovery`。
- Web 工作台、Git 面板、人机协作编辑与 Markdown p5 动画：运行 `concord --skill view`。
- 本地反馈、GitHub / Linear 导入与处理：运行 `concord --skill feedback`。
- `concord repo` 与通用模式差异：运行 `concord --skill repository`。
- 只有确实需要完整离线资料时才运行 `concord --skill all`。

## 为什么这样设计

- Feature 与 Use Case 用使用者目标和可观察结果描述能力。人和 agent 读同一份文字就能判断需求、实现和测试是否一致，不需要先懂内部代码。
- 行为与实现分页。Feature 的 README、Use Case、cli、library 页写外部可见行为；cli 页直接写命令、人读输出、`--json` 字段、退出码和错误。architecture 页写这个 Feature 怎么实现。
- 实现会随功能演进而调整，行为契约应保持稳定。只改实现的重构只改 architecture 页；行为改变时先改行为页。测试标记指向行为契约，因此不随重构失效。
- Roadmap 与 Feature 同体裁，只是尚未采用：设计还不完整，或设计好但暂不实现。实现与测试不指向 Roadmap，准备实现时用 `roadmap adopt` 变成 Feature。Engineering 写仓库自己的测试与维护机制，读者是维护者，不写进 Feature。
- 每项事实只有一个 owner，关系从源码标记推导。没有第二份登记表，关系就不会和代码脱节。
- 过程写入 Memory 与 Issue，`docs/` 只保留当前声明。下一次会话读到的是现行约定，而不是旧的讨论。
- 修复要有同一测试的 red 与 green 收据，"已修复"因此可以核验。

完整说明见随包 `docs/why-concord.md`。

## 工作原则

先读取现有 owner 与关系，再决定应修改契约、测试源码还是 Memory。路径是 canonical identity；不要另建反向登记表或测试关系 JSON。文档变更先用 `--dry-run` 检查时，仍须以实际非 dry-run 结果作为完成依据。任何冲突、恢复要求或证据陈旧都应保留现场并处理具名错误，不得绕过 guard。

契约正文声明目标、行为、约束和验收条件；产品流程属于契约。开发日志、排障经过、实施进度与临时计划归工程 Memory，不写入契约正文。观察归 Issue，调查与经验归 Memory，采用后的目标归 Feature。

Memory 与 Issue 必须通过 Concord 工具索引、检索、读取和修改。使用 `memory index/recall`、`issue index/recall` 发现当前内容，使用具名作者与生命周期命令更新；不要直接读写 owner 文件代替工具，不手工维护 INDEX.md、metadata、history 或反向关系。工具缺口先报告或补齐，不能手写文件绕过。

领域术语通过 `concepts index/show/set` 管理，写作政策通过 `writing index/show/set/check` 管理。docs 下 `concepts.json` 与 `concord-writing.json` 的所在目录决定 scope；全项目视图只汇总来源，不复制局部定义到全局。Markdown 写解释和案例，JSON 拥有结构化定义。编辑使用工具与摘要，先读 `concord --skill document` 了解格式和迁移。
