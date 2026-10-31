# Agent 工作入口

已安装 CLI 自带渐进式 skill。先运行 `concord --skill` 取得精简入口和主题列表，需要具体流程时再运行 `concord --skill <topic>`。离线加载全部资料使用 `concord --skill all`。该入口不依赖消费仓库，也不写文件。

在消费仓库遵守其 AGENTS.md；先用 `concord --help` 和对应子命令的 `--help` 获取当前参数。工具安装目录与消费仓库分开，跨目录执行时显式传 `--root`。Agent 与脚本使用 `--json`，不要解析人读输出。

Agent 直接编辑 `docs/` 与 `memory/` 下的全部文件。Concord 命令是执行需要运行的步骤的助手，例如修复核验、Design 裁决与 Roadmap 采用；变化是否合法由 CI 中的 `concord check --since <base>` 检查（[事实归属](document-model.md#事实归属)）。文档的分组与字段见[文档模型](document-model.md)，命令面见 [CLI](feature/local-sdlc/cli.md)。

首次接入用 `concord init`，从 `docs/concord.md` 和 `docs/_template/README.md` 进入。用 `concord doctor --json` 查看配置和接入缺口。

1. 读取现状：`list`、`show <路径或选择器>`、`trace show` 找当前 Spec、实现与测试；`memory search <query>` 与 `issue search <query>` 找知识和打开的 Issue。
2. 已采用的目标写进 Feature：README 写能力，Use Case 写用户路径与验收，architecture 写实现，cli 或 library 写示例。尚未决定做的方向写进 Roadmap，决定后 `roadmap start`。
3. 有取舍时写 Design，`design decide` 裁决。把选中方案中仍适用的规则写进相应的 Feature、architecture 或 engineering 页；Spec 只把 Design 的 README 或 DECISION 链接为决策依据（[Design 记录](document-model.md#design-记录)）。
4. 实现带 `@concord-implements`，测试带 `@feature` 或 `@use-case`；每条验收至少一个测试。`test marker --contract <ref>` 输出经过引用检查的标记。
5. 缺陷写成 Issue。先提交会失败的回归测试并附 `@issue <path>`，再单独提交修复；`issue close <issue> --fixed` 核验并写入结论，`test verify <issue>` 重放（[证据的范围](feature/local-sdlc/scope.md#证据的范围)）。
6. 可复用的知识与不需要 Design 的决策直接写进 `memory/`。实施过程、排障经过与交接不写进 `docs/`（[只写当前声明](document-model.md#只写当前声明)）。
7. 交接前 `check` 无 finding，测试通过，`trace gaps` 的缺口都有打开的 Issue；`review` 生成审阅材料。

HawDB 缓存损坏时源码查询会回源。`cache clear` / `cache rebuild` 只处理缓存；写事务中断使用 `recover`。恢复遇到未知修改时先保留现场，查明冲突，不删除 journal 强行绕过。

Concord 不发送远端消息；提交、push、部署和发布仍遵守用户授权及消费仓库规则。
