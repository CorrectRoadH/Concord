# 契约与文档

已采用的当前目标写入 Feature，叶子用户路径写入 Use Case；尚未采用的定稿方向写入 Roadmap，多方案比较写入 Design，自由研究与决策输入写入 Research，仓库测试与维护机制写入 Engineering。

契约正文采用声明式表达：写产品必须具备的行为、边界与验收，不写“这轮做了什么”、开发流水账、实施进度或临时计划。用户操作流程、状态迁移和验收步骤可以保留。排障经过与交付经验使用 `concord memory add` 保存；待调查观察使用 `concord issue create`。Research 的来源事实和工具维护的历史不因这条规则被删除或伪装成目标契约。

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

除了完整模板页，也可用 Unicode 名称新增专题页，例如 `认知与执行`、`常识与上下文` 或 `plan-history`。专题页仍属于 package，不成为独立 owner。Design 外层支持专题页，候选中的页面用 `--plan`；既有目标、约束和裁决页保留各自位置。

```sh
concord feature page show login cli --json
concord feature page set login cli --body ./login-cli.md --expected-digest 'sha256:...'
concord feature page add login migration
concord design page show session-store architecture --plan sqlite
```

`page set` 必须使用 `page show --json` 返回的最新整文件 digest；Design candidate 用 `--plan <alternative>`。正式裁决与采用分别由具名命令完成：

```sh
concord design check session-store
concord --dry-run design format session-store
concord design format session-store
concord design decide session-store --selected sqlite --target docs/feature/login/README.md --reason "满足本地事务约束"
concord roadmap adopt sessions --feature sessions
```

定案前，GOALS/LIMITS 用 `## G1: 标题`、`## L1: 标题` 定义稳定条目；每个候选 README 的 `## Goals`、`## Limits` 各用四列表格逐项写出要求链接、状态、机制/缺口和依据。状态支持 satisfied/not-satisfied/pending（满足/不满足/待验证），Goal 另支持 partial（部分满足）。链接例如 `[L1](../../LIMITS.md#l1-offline)`，必须指向实际标题。代码块、HTML 和引用式链接不作为要求回应。

DECISION 的 `## Decision` 只放 `Selected: [sqlite](plans/sqlite/README.md)` 或 `选择 [sqlite](plans/sqlite/README.md)。`；`## Rationale`、`## Rejected Options`、`## Residual Risks` 写真实论证。每个非 satisfied 的已选 Goal 需在 Rationale 单独写 `G1: 接受缺口的理由`。全部候选必须完整回应，所选候选的所有 Limit 必须 satisfied。`design check` 检查当前正文，结构通过不代表真实验证；`design format` 只整理已识别的 H2 和四列表格空白，不能生成选择或证据。定案收据中的 changedPaths 包括保护已校验输入的同内容 guards。

普通 supporting page 不成为第二个 metadata 真源。Roadmap adopt 会创建新 Feature、保留 Roadmap 历史，并迁移当前 promotion。修改 owner 正文时读取最新 digest，再执行：

```sh
concord author set docs/feature/login/README.md --body ./login.md --expected-digest 'sha256:...'
```

不要手改工具拥有的 metadata 或历史；路径和 anchor 是关系身份，链接目标必须是 canonical repository-relative reference。

## 术语与写作政策

用 `concepts index/show/set` 和 `writing index/show/set/check` 发现、读取和管理 JSON owner，编辑先取得最新 digest。全局定义在 docs/concepts.json；Feature、Engineering 或其它 docs 子目录可分别放 concepts.json 和 concord-writing.json。精确文件名与目录决定 scope，docs/_template 排除，局部 roots 不得越界。

concepts 使用 concord.concepts/v1：稳定局部 id、definition、多语言 preferred/aliases/deprecated 和可选直接 imports。允许别名不成为禁词，只有明确 deprecated 才派生规则。Markdown 保留解释和案例；全项目术语表只读汇总，不写第二份词库。删除或改名被引用的概念会被拒绝。

政策使用 concord.writing/v2。根集合用于选文件，祖先规则仍按有效范围应用；省略阈值表示继承，null 表示清除，布尔 false 表示关闭。同名概念和规则冲突保留全部来源，不默默覆盖。作用域、语料与恢复的精确定义见随包 docs/feature/documentation-quality/policy.md。

`concord docs check --json` 自动发现政策与概念；`--rules <path>` 选择受管政策的扫描根，或使用外部只读 profile。报告说明实际范围与输入快照。发现问题退出 1，逐处核对上下文，不机械全仓替换；这不是测试覆盖率或实现证明。

旧 writing/v1 的普通检查返回 WritingMigrationRequired。先 show 取得原文与摘要，作者审核并用 concepts.set 保存 JSON，再用 writing.set 和旧摘要显式替换为 v2。概念编辑不因仍存在旧政策而被阻断，中间阶段不宣称检查通过。不要从旧表的名字编造定义；有旧 journal 时先用匹配的旧 CLI 恢复，不能绕过新授权边界。

文档 ID 与专题名允许 Unicode 字母、组合标记和数字，可用单连字符分隔；例如 `concord use-case create 扩展NPC动作 --feature npc --title "扩展 NPC 动作"` 和 `concord feature page add npc 认知与执行`。名称保留原样，不翻译或自动更改大小写；禁止路径分隔符、空白和路径穿越。固定入口 README.md、architecture.md 等继续保留。
