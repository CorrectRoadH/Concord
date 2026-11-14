---
name: concord
description: 在本地 Git 仓库中使用 Concord 维护产品 Spec、代码与测试标记、Issue、工程 Memory、追踪关系与原生测试收集；需要读写 Concord 文档、关闭缺陷或解释检查结论时使用。
---

# Concord

Concord 让 Markdown Spec 成为软件的唯一事实来源：Spec、源码与测试中的 Concord 标记、Issue 与 Memory 各自保存在自己的文件里，关系从中推导。先遵守接入项目的 `AGENTS.md`，并用对应命令的 `--help` 核对当前参数。脚本和 Agent 优先使用 `--json`；跨目录操作时显式传 `--root <worktree>`。

`docs/` 与 `memory/` 下的文件都可以直接编辑。具名命令执行需要运行的步骤，例如原生收集、Issue 关闭与 Roadmap 采用；各操作的当前写法由对应主题说明。

只在任务授权范围内修改文件或运行写命令。`check`、`trace` 无 finding 不等于测试覆盖率；提交、push、发版、部署和远端消息仍需独立授权。

## 按需读取

- 首次接入、配置或模板：运行 `concord --skill init`。
- 开发流程的四步：写 Spec 运行 `concord --skill spec`，照着 Spec 实现运行 `concord --skill implement`，按 Spec 验收运行 `concord --skill review`，修复缺陷运行 `concord --skill fix`。项目中的 `concord-spec` 等 skill 就是这四个 skill 主题的入口。
- 为项目写第一批 Spec：运行 `concord --skill start`，结合本次目标与仓库现状选择指南；补写用 `concord --skill docs-from-code`，新项目用 `concord --skill docs-from-scratch`，已明确的范围直接沿用。
- Feature、Use Case、Engineering、Roadmap、Design 的布局、写法与采用：运行 `concord --skill document`，同时取得文档模型、目录树和完整成稿示例。
- 整文件、函数和代码段的实现关联与位置查询：运行 `concord --skill code`。
- 测试标记、具体用例与 label 收集：运行 `concord --skill test`。
- Memory 的内容、关系与维护：运行 `concord --skill memory`。
- Issue、缺陷修复流程与 GitHub / Linear 来源：运行 `concord --skill feedback`。
- 检查、关系追踪与审阅：运行 `concord --skill trace`。
- cache 或中断写入恢复：运行 `concord --skill recovery`。
- Web 工作台、Git 面板、人机协作编辑与 Markdown p5 动画：运行 `concord --skill view`。
- 只有确实需要完整离线资料时才运行 `concord --skill all`。

## 工作原则

- 先读取现有文档与相关代码，沿用已明确的目标、范围与授权。写文档先形成可审阅正文，再在获得授权的实现或关联阶段处理源码与测试标记。
- Spec 声明目标、行为、约束和验收。按主要使用者的实际入口写上手路径；Use Case 按用户目标拆分。内部结构与资源生命周期写在 architecture 或 data-model 页。
- 文档分类、页面职责与身份规则由 `concord --skill document` 中的文档模型拥有；按需创建页面，不复制整套空模板。领域术语先在生效的 `concepts.md` 定义，写作规则归 `writing.md`。
- Memory 只保存可复用经验，Issue 只保存仍需处理的问题；执行日志、进度和核验记录留在任务交付中。修复流程读取 `concord --skill fix`，不强制为即时小修复创建 Issue。
- 每项事实只有一个 owner，索引与反向关系从文件派生。用 `concord list`、`concord show` 和查询命令发现内容，不手工维护第二份登记表。
- 完成写改任务前必须实际运行 `concord check` 并确认通过。发现问题时继续修复、重跑，不能以记录 Issue、报告 finding 或承诺以后处理替代完成。本次删除或修改 Spec 引起的源码、测试标记与关联迁移属于同一任务，须按已有授权同步完成。若受权限、环境或明确的只读／分工范围阻塞，交付必须标为未完成，列出具体失败、受阻项和所需条件；不得越权修改或把失败写成通过。只读审阅仍只交付发现。
- Spec 可以随新证据修订。完整开发任务先回到写 Spec 阶段收敛，再继续实现；分工任务交给相应负责人，只有未获授权的关键取舍才询问用户。现有授权持续有效。
- 验证结论只覆盖实际运行的命令与边界。结构检查不代替正文审阅，关联不等于行为覆盖；使用代表性任务审阅指南时，明确区分静态审阅与模型实际执行。
