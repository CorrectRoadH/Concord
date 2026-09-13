# Agent 工作入口

在消费仓库遵守其 AGENTS.md；先用 `concord --help` 和对应子命令的 `--help` 获取当前参数。工具安装目录与消费仓库分开，跨目录执行时显式传 `--root`。

1. 用 `feature list`、`trace show <canonical-path>`、`memory search <query>` 找当前契约和历史问题。`check` 校验当前关系，不执行测试。
2. 已采用的用户目标进入 Feature / Use Case；尚未采用的定稿方向进入 Roadmap，多方案比较进入 Design，带日期的事实进入 Research。创建命令读取 `--body <file>` 或 `--body -`，写入前可以 `--dry-run`。
3. 新问题进入 `memory add --kind problem`。在真实测试声明紧邻注释中写 case ID、contract、regression；关系直接随测试源码参与 Git diff。不要手写运行收据或制造第二份测试关系 JSON。
4. `test run <id> --json` 返回 command 收据。修复时先取得正常失败的 red，保持测试定义及契约不变，修改产品实现，再取得 green。`memory resolve --kind fixed` 传两份 ID 和实际修复理由。超时、零执行、已知全跳过或陈旧候选不能作为修复证据。
5. 问题再现使用 `memory reopen`；旧轮次收据不能关闭新轮次。作者裁决使用对应的非 fixed 理由，不用普通命令结果冒充原生用例覆盖证明。
6. 晋升 Memory 到有效契约用 `memory promote`；采用 Roadmap 用 `roadmap adopt`，由工具一起迁移当前 promotion。修改正文用 `author set` 和最新 owner digest，保留受管历史。
7. 用 `check`、`trace show`、`review render` 交接。私有证据缺失要保留“不可用”的事实，不能把历史结论当当前运行结果。

SQLite 损坏时查询会回退源码。`cache clear` / `cache rebuild` 只处理缓存；写事务中断使用 `recover`。恢复遇到未知修改时先保留现场，查明冲突，不删除 journal 强行绕过。

本地 Issue 草稿与 Memory 工程状态独立。Concord 不发送远端消息；提交、push、部署和发布仍遵守用户授权及消费仓库规则。
