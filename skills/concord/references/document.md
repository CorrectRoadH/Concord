# 契约与文档

已采用的当前目标写入 Feature，叶子用户路径写入 Use Case；尚未采用的定稿方向写入 Roadmap，多方案比较写入 Design，自由研究与决策输入写入 Research，仓库测试与维护机制写入 Engineering。

```sh
concord feature create login --title "登录" --pages cli,use-case
concord use-case create expired-token --feature login --title "拒绝过期令牌"
concord research create auth-input --title "认证调研"
concord research page add auth-input 资料/比较
concord roadmap create sessions --title "会话路线图"
concord design create session-store --title "会话存储" --alternative sqlite --alternative files --pages architecture
concord engineering create ci --title "持续集成"
```

创建时省略 `--body` 会使用模板；`--body <file>` 或 `--body -` 提交完整正文。结构写入可在根命令加 `--dry-run`。用 `list` 发现 owner，用 `show <id>` 读取 metadata 与派生关系；正文直接读取返回的路径，或用 `page show` 查看附页。

Research 使用目录 README，默认只有标题，不预设章节、日期、来源或附页。`--observed-at` 和 `--source` 可选；附页接受安全相对路径（含中文和子目录），不会套用其它类型的模板。旧单文件须先使用离线目录迁移工具。

Feature、Roadmap 和 Design candidate 只要求 README。可选页为 library（公开 API）、cli（命令）、architecture（内部边界）、lifecycle（资源与状态）、use-case（用户目标索引）。`--pages` 支持逗号分隔或重复传入，省略时采用初始化时冻结的项目默认；`--no-pages` 明确覆盖为空，仅建 README。全套用 `--pages library,cli,architecture,lifecycle,use-case`。同次 Design 创建对所有候选使用相同选择，外层 README、GOALS、LIMITS、CASES、DECISION 始终生成。Use Case 索引不创建叶子用例。

Feature 与 Design 可重复传 `--constitution-ref docs/constitution.md#c-001` 声明适用条款。条款必须是当前 `docs/constitution.md` 中唯一、真实的行级 anchor；Concord 派生反向影响，但不声称语义合规。

Engineering 默认 README 包含目标、机制、使用和验收，按内容用 `engineering page add` 扩展，不接受创建时的 `--pages`。已有包不迁移或删除页面；依赖旧全量默认的脚本应显式选择全套。`page add` 不修改作者 README，新增页后维护其入口链接。页面维护命令为：

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
