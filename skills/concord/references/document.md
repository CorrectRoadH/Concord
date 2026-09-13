# 契约与文档

已采用的当前目标写入 Feature，叶子用户路径写入 Use Case；尚未采用的定稿方向写入 Roadmap，多方案比较写入 Design，带日期的决策输入写入 Research，仓库测试与维护机制写入 Engineering。

```sh
concord feature create login --title "登录"
concord use-case create expired-token --feature login --title "拒绝过期令牌"
concord research create auth-input --title "认证调研" --observed-at 2026-09-13 --source ./source.md
concord roadmap create sessions --title "会话路线图"
concord design create session-store --title "会话存储" --alternative sqlite --alternative files
concord engineering create ci --title "持续集成"
```

创建时省略 `--body` 会使用模板；`--body <file>` 或 `--body -` 提交完整正文。结构写入可在根命令加 `--dry-run`。用 `list` 发现 owner，用 `show <id>` 读取主 owner。

Feature、Roadmap、Engineering 和 Design candidate 是多页 package。页面维护命令为：

除了完整模板页，也可用小写 slug 新增专题页，例如 `migration`、`goals` 或 `plan-history`。专题页仍属于 package，不成为独立 owner。Design 外层支持专题页，候选中的页面用 `--plan`；既有目标、约束和裁决页保留各自位置。

```sh
concord feature page show login cli --json
concord feature page set login cli --body ./login-cli.md --expected-digest 'sha256:...'
concord feature page add login migration
concord design page show session-store architecture --plan sqlite
```

`page set` 必须使用 `page show --json` 返回的最新整文件 digest；Design candidate 用 `--plan <alternative>`。正式裁决与采用分别由具名命令完成：

```sh
concord design decide session-store --selected sqlite --target docs/feature/login/README.md --reason "满足本地事务约束"
concord roadmap adopt sessions --feature sessions
```

普通 supporting page 不成为第二个 metadata 真源。Roadmap adopt 会创建新 Feature、保留 Roadmap 历史，并迁移当前 promotion。修改 owner 正文时读取最新 digest，再执行：

```sh
concord author set docs/feature/login/README.md --body ./login.md --expected-digest 'sha256:...'
```

不要手改工具拥有的 metadata 或历史；路径和 anchor 是关系身份，链接目标必须是 canonical repository-relative reference。
