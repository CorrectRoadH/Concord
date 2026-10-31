---
name: concord
description: 在本地 Git 仓库中使用 Concord 维护产品 Spec、代码与测试标记、Issue、工程 Memory、追踪关系与修复核验；需要读写 Concord 文档、关闭缺陷或解释检查结论时使用。
---

# Concord

Concord 让 Markdown Spec 成为软件的唯一事实来源：Spec、源码与测试中的 Concord 标记、Issue 与 Memory 各自保存在自己的文件里，关系从中推导。先遵守消费仓库的 `AGENTS.md`，并用对应命令的 `--help` 核对当前参数。脚本和 Agent 优先使用 `--json`；跨目录操作时显式传 `--root <worktree>`。

`docs/` 与 `memory/` 下的全部文件都可以直接编辑，包括 Issue 与 Memory 的状态和关系。具名命令是执行需要运行的步骤的助手，例如修复核验与 Design 裁决，它们把结果写进同一份文件；可信度由 `concord check --since <base>` 的门禁保证，CI 对每个变更运行它。

只在任务授权范围内修改文件或运行写命令。`check`、`trace` 无 finding 不等于测试覆盖率；提交、push、发布、部署和远端消息仍需独立授权。

## 按需读取

- 首次接入、配置或模板：运行 `concord --skill init`。
- Feature、Use Case、Engineering、Roadmap、Design、Research 的布局、写法与采用：运行 `concord --skill document`。
- 整文件、函数和代码段的实现关联与位置查询：运行 `concord --skill code`。
- 测试标记、测试执行与修复核验：运行 `concord --skill test`。
- Memory 的类型、状态与关系：运行 `concord --skill memory`。
- Issue、缺陷修复流程与 GitHub / Linear 来源：运行 `concord --skill feedback`。
- 检查、差异门禁、关系追踪与审阅：运行 `concord --skill trace`。
- cache 或中断写入恢复：运行 `concord --skill recovery`。
- Web 工作台、Git 面板、人机协作编辑与 Markdown p5 动画：运行 `concord --skill view`。
- 只有确实需要完整离线资料时才运行 `concord --skill all`。

## 布局

| 路径 | 内容 |
| --- | --- |
| `docs/feature/<f>/` | Feature：README、`use-case/<u>.md`、`architecture.md`、`cli.md` 或 `library.md`，以及支持页面 |
| `docs/engineering/<t>/` | Engineering，页面结构同 Feature |
| `docs/roadmap/<r>/` | 尚未采用的方向，页面结构同 Feature |
| `docs/design/<d>/`、`docs/research/<r>/` | Design 与 Research |
| `docs/issues/<i>.md` | Issue：缺陷、请求与观察 |
| `memory/<m>.md` | Memory：decision、insight、note |
| `docs/constitution.md`、`docs/**/concepts.md`、`docs/**/concord-writing.json` | 宪法、概念与写作政策 |

仓库相对路径是文档的唯一身份，名称取自正文唯一的一级标题。目录名与文件名可以作短选择器，同类中有歧义时命令具名拒绝并要求写出路径。移动文件即改变身份，`check` 报告全部失效的精确引用。

## 为什么这样设计

- Feature 与 Use Case 用使用者目标和可观察结果描述能力。人和 agent 读同一份文字就能判断需求、实现和测试是否一致，不需要先懂内部代码。
- 行为与实现分页。README、Use Case、cli、library 页写外部可见行为，cli 页直接写命令、人读输出、`--json` 字段、退出码和错误；architecture 页写实现与资源生命周期。只改实现的重构只改 architecture 页，测试标记指向行为 Spec，因此不随重构失效。
- Roadmap 与 Feature 同体裁，只是尚未采用。实现与测试不指向 Roadmap，准备实现时用 `roadmap adopt` 移入 `docs/feature/`。Engineering 写仓库自己的测试与维护机制，读者是维护者。
- 能从路径、一级标题与 Git 推导的事实不写进文件，因此 Spec 没有 frontmatter；生命周期状态、带角色的关系、远端来源身份与关闭结论推导不出，写在 Issue、Memory 的 frontmatter，只在非空时出现。
- 每项事实只有一个 owner，正向关系只保存一次，反向关系从源码标记与 frontmatter 推导，不另建登记表。
- 过程写入 Memory 与 Issue，`docs/` 的 Spec 只保留当前声明。下一次会话读到的是现行约定。
- 修复可以核验：先提交在缺陷上失败的回归测试，再提交修复，`issue close --fixed` 在两个提交上各运行一次，把结论写进 Issue，任何人都能重放。

决策依据见随包 `docs/design/sdd-core-model/DECISION.md`，完整说明见随包 `docs/why-concord.md`。

## 工作原则

先读取现有文件与关系，再决定应修改 Spec、测试源码、Issue 还是 Memory。直接编辑后运行 `concord check`；提交前运行 `concord check --since <base>`，处理每个具名 finding，不绕过门禁。冲突、恢复要求或核验失败时保留现场并处理具名错误。

Spec 正文声明目标、行为、约束和验收条件；产品流程属于 Spec。写 Feature README 或 Use Case 前先读 `concord --skill document` 的「让第一次读的人读懂」：README 给出能做什么和上手示例，Use Case 按教程写，复杂过程配 p5 图解，领域名词先进入 `concepts.md` 再使用。开发日志、排障经过、实施进度与临时计划归 Memory，待调查的观察与缺陷归 Issue，采用后的目标归 Feature。

索引与反向关系从文件派生：用 `concord list` 与 `concord show` 读取文档及其关系，不手工维护 INDEX 或反向列表。领域术语写在所在目录的 `concepts.md`，写作政策写在 `concord-writing.json`；所在目录决定作用域，`check` 校验结构、作用域与被引用的定义，全项目视图只汇总来源。格式见 `concord --skill document`。
