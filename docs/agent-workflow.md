# Agent 工作入口

已安装 CLI 自带渐进式 skill。先运行 `concord --skill` 取得精简入口，需要具体流程时再运行 `concord --skill <init|document|test|memory|trace|recovery|repository>`；只有离线加载全部资料时使用 `concord --skill all`。该入口不依赖消费仓库、不加载 repository host，也不写文件。

在消费仓库遵守其 AGENTS.md；先用 `concord --help` 和对应子命令的 `--help` 获取当前参数。工具安装目录与消费仓库分开，跨目录执行时显式传 `--root`。

首次接入用 `concord init`，完整目录和模板由 init 一次建好，从 `docs/concord.md` 和 `docs/_template/README.md` 进入。`template list/show` 可在未初始化时读取随包模板；创建文档不传 `--body` 会生成写作提示，传 `--body -` 仍可直接提交完整正文。各类文档直接生成完整结构，`page show --json` 提供 `page set --expected-digest` 使用的最新摘要。Engineering 保存维护机制，Design 候选由 `--alternative` 声明并使用 `--plan` 操作页面。

用 `concord doctor --json` 查看配置和接入缺口。`test annotate <id> --contract <ref>` 只输出经过引用检查的源码注释；把它放到真实测试声明旁再运行 `check`。模板和注释均不证明测试执行或功能覆盖。Agent 与脚本使用 `--json`，不要解析人读输出。

1. 用 `feature list`、`trace show <canonical-path>`、`memory search <query>` 找当前契约和历史问题。`check` 校验当前关系，不执行测试。
2. 已采用的用户目标进入 Feature / Use Case；尚未采用的定稿方向进入 Roadmap，多方案比较进入 Design，带日期的事实进入 Research。创建命令读取 `--body <file>` 或 `--body -`，写入前可以 `--dry-run`。
3. 新问题进入 `memory add --kind problem`。在真实测试声明紧邻注释中写 case ID、contract、regression；关系直接随测试源码参与 Git diff。不要手写运行收据或制造第二份测试关系 JSON。
4. `test run <id> --json` 返回 command 收据。修复时先取得正常失败的 red，保持测试定义及契约不变，修改产品实现，再取得 green。`memory resolve --kind fixed` 传两份 ID 和实际修复理由。超时、零执行、已知全跳过或陈旧候选不能作为修复证据。
5. 问题再现使用 `memory reopen`；旧轮次收据不能关闭新轮次。作者裁决使用对应的非 fixed 理由，不用普通命令结果冒充原生用例覆盖证明。
6. 晋升 Memory 到有效契约用 `memory promote`；采用 Roadmap 用 `roadmap adopt`，由工具一起迁移当前 promotion。修改正文用 `author set` 和最新 owner digest，保留受管历史。
7. 用 `check`、`trace show`、`review render` 交接。私有证据缺失要保留“不可用”的事实，不能把历史结论当当前运行结果。

HawDB 缓存损坏时源码查询会回源。`cache clear` / `cache rebuild` 只处理缓存；写事务中断使用 `recover`。恢复遇到未知修改时先保留现场，查明冲突，不删除 journal 强行绕过。

本地 Issue 草稿与 Memory 工程状态独立。Concord 不发送远端消息；提交、push、部署和发布仍遵守用户授权及消费仓库规则。
