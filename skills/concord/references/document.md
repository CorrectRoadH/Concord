# Spec 与文档

已采用的当前目标写入 Feature，叶子用户路径写入 Use Case；设计未完成或暂不实现的方向写入 Roadmap（与 Feature 同体裁），多方案比较写入 Design，自由研究与决策输入写入 Research，仓库测试与维护机制写入 Engineering。

Spec 正文采用声明式表达：写产品必须具备的行为、边界与验收，不写“这轮做了什么”、开发流水账、实施进度或临时计划。用户操作流程、状态迁移和验收步骤可以保留。排障经过与交付经验使用 `concord memory add` 保存；待调查观察使用 `concord issue create`。Research 的来源事实和工具维护的历史不因这条规则被删除或伪装成目标 Spec。

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

图示按表达需要选择：Mermaid 描述结构与流程，`p5` 代码块解释动画、连续变化和交互。图示旁保留结论与关键条件，未运行时也能理解 Spec。p5 使用完整实例函数或简写 `p.setup` / `p.draw`，外部入口相对所在 Markdown；扩展库统一配置在项目 `p5.libraries`，不要在代码块声明库或插入 CDN script。可复制示例与沙箱边界见 `concord --skill view`。

Research 使用目录 README，默认只有标题，不预设章节、日期、来源或附页。`--observed-at` 和 `--source` 可选；附页接受安全相对路径（含中文和子目录），不会套用其它类型的模板。输入必须符合当前目录与 metadata 规则；发现过程不转换文件。

## 写作指南

先问读者要回答什么，再决定写在哪一页：

| 读者的问题 | 写在 | 写法 |
| --- | --- | --- |
| 功能对使用者做什么 | Feature README | 问题、概念、范围与非目标 |
| 一个目标怎样完成 | Use Case | 用户目标、起始状态、带 `{#id}` 的完整路径、结果、Spec 来源 |
| 命令或 API 怎样调用、返回什么 | cli、library | 完整调用、人读输出、`--json` 输出、退出码、具名错误、最小示例 |
| 它是怎么实现的 | architecture、lifecycle | 实体归属、数据流、不变量、失败阶段、资源生命周期 |
| 为什么这样选 | Design | 目标、约束、候选与裁决；裁决后只作记录 |
| 排障经过、根因、经验 | Memory | `concord memory add` |
| 待调查的观察 | Issue | `concord issue create` |

行为页的规范性陈述要能被测试断言。已实现的命令在临时仓库实际运行，复制输出，把每次运行都会变化的摘要和时间戳写成省略号或说明；尚未实现时标为预期输出，交付验收再核对实际运行，运行记录写进 Memory。错误写成表格，列出错误码和触发条件。`--json` 字段、错误码和退出码属于公开 Spec；人读输出帮助理解，不保证逐字稳定。同一输出或错误只在一个页面定义，其它页面链接过去。

行为页不写内部模块、内部数据结构、调用链、缓存或存储引擎；公开的输入输出结构、协议和可观察的恢复保证留在行为页。出现这些词时，把那段移到 architecture 页，行为页只保留使用者能观察到的保证，例如“删除缓存后结论不变”。architecture 页不重新定义行为；只改实现时只改 architecture 页。

正文写现行规则，不写“目前”“已实现”“这次改了什么”，不点名已删除的接口。Use Case 主流程的步骤加 `{#id}`，测试和实现可以指向具体步骤。

Feature、Roadmap 和 Design candidate 只要求 README。可选页为 library（公开 API）、cli（命令）、architecture（内部边界）、lifecycle（资源与状态）、use-case（用户目标索引）。`--pages` 支持逗号分隔或重复传入，省略时采用初始化时冻结的项目默认；`--no-pages` 明确覆盖为空，仅建 README。全套用 `--pages library,cli,architecture,lifecycle,use-case`。同次 Design 创建对所有候选使用相同选择，外层 README、GOALS、LIMITS、CASES、DECISION 始终生成。Use Case 索引不创建叶子用例。

依据宪法的句子旁写指向条款或款 ID 的行内链接，例如 `错误消息不含凭据（[C-007](../../constitution.md#c-007-4)）`，不用“第 N 款”这类序号文字。docs/ 下除 `docs/_template/` 与宪法本身外的所有 Markdown 都可以链接，附页、Issue 与 Research 同样计入；图片、引用式链接、代码与注释中的链接不计入。`concord check` 对指向不存在 ID 的链接报告 `AnchorNotFound`，对带 query 或无法解码的宪法链接报告 `ConstitutionLinkInvalid`；`concord constitution show` 从这些链接派生反向视图，不声称语义合规。

宪法条款写成 `## C-001 规则本身 {#c-001}`，款是条款下根有序列表项，第一段末尾写 ` {#c-001-1}`；总则用 `## 总则 {#general}`，其款用 `{#general-<name>}`。ID 一经采用不改名、不复用。条款写法：每条款一项跨功能规则，标题就是规则；每款一项可审阅的义务、禁止或许可；条款写约束，不写达成约束的机制；用现行句式；依据规则的句子旁链接 ID。v1 宪法或带 `constitutionRefs` 的元数据返回 `ConstitutionMigrationRequired`，用 `concord constitution migrate` 一次转换。

Engineering 默认 README 包含目标、机制、使用和验收，按内容用 `engineering page add` 扩展，不接受创建时的 `--pages`。`page add` 只新增页面，不删除已有页面。`page add` 不修改作者 README，新增页后维护其入口链接。页面维护命令为：

除了完整模板页，也可用 Unicode 名称新增专题页，例如 `认知与执行`、`常识与上下文` 或 `plan-history`。专题页仍属于 package，不成为独立 owner。Design 外层支持专题页，候选中的页面用 `--plan`；既有目标、约束和裁决页保留各自位置。

```sh
concord feature page show login cli --json
concord feature page set login cli --body ./login-cli.md --expected-digest 'sha256:...'
concord feature page add login migration
concord design page show session-store architecture --plan sqlite
```

了解现行行为只读 Feature、Use Case、cli、library、architecture 与 engineering 页；Design 只在重新审视某项决策时读取。`design decide` 之后，把选中候选中仍适用的规则写入这些页面，Spec 只把 Design 的 README 或 DECISION 链接为依据；链接到候选页、CASES、GOALS 或 LIMITS 时 `concord check` 报告 `SpecDependsOnDesignRecord`。

`page set` 必须使用 `page show --json` 返回的最新整文件 digest；Design candidate 用 `--plan <alternative>`。正式裁决与采用分别由具名命令完成：

```sh
concord design check session-store
concord --dry-run design format session-store
concord design format session-store
concord design decide session-store --selected sqlite --target docs/feature/login/README.md --reason "满足本地事务约束"
concord design correct-reason session-store --reason "满足本地事务约束与恢复要求" --memory decision-corrections --explanation "细化方案依据" --expected-digest 'sha256:...' --expected-memory-digest 'sha256:...'
concord roadmap adopt sessions --feature sessions
```

定案前，GOALS/LIMITS 用 `## G1: 标题`、`## L1: 标题` 定义稳定条目；每个候选 README 的 `## Goals`、`## Limits` 各用四列表格逐项写出要求链接、状态、机制/缺口和依据。状态支持 satisfied/not-satisfied/pending（满足/不满足/待验证），Goal 另支持 partial（部分满足）。链接例如 `[L1](../../LIMITS.md#l1-offline)`，必须指向实际标题。代码块、HTML 和引用式链接不作为要求回应。

DECISION 的 `## Decision` 只放 `Selected: [sqlite](plans/sqlite/README.md)` 或 `选择 [sqlite](plans/sqlite/README.md)。`；`## Rationale`、`## Rejected Options`、`## Residual Risks` 写真实论证。每个非 satisfied 的已选 Goal 需在 Rationale 单独写 `G1: 接受缺口的理由`。全部候选必须完整回应，所选候选的所有 Limit 必须 satisfied。

`design check` 检查当前正文，结构通过不代表真实验证；`design format` 只整理已识别的 H2 和四列表格空白，不能生成选择或证据。定案收据中的 changedPaths 包括保护已校验输入的同内容 guards。
已有裁决的理由更正要求 Design 与指定 Memory 的最新摘要，且 Design 当前字节与 Git HEAD 一致。命令只更正理由，在 Memory 留存原文的 Git 来源与更正说明；选择、目标、定案时间及来源保持不变。

普通 supporting page 不成为第二个 metadata 真源。Roadmap adopt 会创建新 Feature、保留 Roadmap 历史，并迁移当前 promotion。修改 owner 正文时读取最新 digest，再执行：

```sh
concord author set docs/feature/login/README.md --body ./login.md --expected-digest 'sha256:...'
```

不要手改工具拥有的 metadata 或历史；路径和 anchor 是关系身份，链接目标必须是 canonical repository-relative reference。

## 术语与写作政策

用 `concepts index/show/set` 和 `writing index/show/set/check` 发现、读取和管理术语与写作 owner，编辑先取得最新 digest。全局定义在 docs/concepts.md；Feature、Engineering 或其它 docs 子目录可分别放 concepts.md 和 concord-writing.json。精确文件名与目录决定 scope，docs/_template 排除，局部 roots 不得越界。

concepts.md 不设版本字段。正文恰好一个一级标题，位于所有概念之前；每个二级标题为 `term {#id}`，term 是唯一纯文本写法，后面的第一个段落是定义，其余是解释。可选 YAML frontmatter 严格只接受直接 imports 和按本文件 ID 分组的 deprecated；只有弃用名派生禁词并建议改为 term。catalog 整份不计为使用，但仍参与写作检查；解释中提及弃用名时放在行内代码里。全项目术语表只读汇总，不写第二份词库。

`concepts show` 返回 source、digest、解析结果及诊断，区分 missing/valid/invalid。`concepts set --path docs/feature/example/concepts.md --body /tmp/concepts.md --expected-digest <digest>` 按提交的完整 Markdown 字节保存。正文使用 `--body -` 时从 stdin 读取；新建时摘要为 null。

action `concepts.set` 接受 `{ path, source, expectedDigest }`。结构错误为 InvalidConceptCatalog，消息带行号；导入悬空为 DanglingConceptImport，有效范围同名为 AmbiguousConceptName。

被其它 catalog imports 引用的定义不能删除或改名。正文可以链接到 concepts.md#id；缺失 ID 由 check 报告 relation 类 AnchorNotFound，正文链接不阻止写入。author set、page set、page add 与 Web 通用保存遇到 catalog 路径返回 ManagedConceptCatalog，改用 concepts set。Concord 只识别 concepts.md；concepts.json 不读取、不检测、不提示、不提供迁移，作者手动按当前结构改写。

政策使用 concord.writing/v3。根集合用于选文件，祖先规则仍按有效范围应用；省略阈值表示继承，null 表示清除，布尔 false 表示关闭。同名概念和规则冲突保留全部来源，不默默覆盖。作用域、语料与恢复的精确定义见随包 docs/feature/documentation-quality/policy.md。

`concord docs check --json` 自动发现政策与概念；`--rules <path>` 选择受管政策的扫描根，或使用外部只读 profile。报告说明实际范围与输入快照。发现问题退出 1，逐处核对上下文，不机械全仓替换；这不是测试覆盖率或实现证明。

文档 ID 与专题名允许 Unicode 字母、组合标记和数字，可用单连字符分隔；例如 `concord use-case create 扩展NPC动作 --feature npc --title "扩展 NPC 动作"` 和 `concord feature page add npc 认知与执行`。名称保留原样，不翻译或自动更改大小写；禁止路径分隔符、空白和路径穿越。固定入口 README.md、architecture.md 等继续保留。


受控规则在 `controlled` 中按叶子合成，null 清除子树，每种语言的词表和 allowIn 整表替换。数值开启长度检查；词法开关默认 false。程序性动作词开关需要有效非空 verbs 表（auto 要求 zh/en）；英文被动候选需要显式 participles。字符长度与受控 token 长度可同时生效。精确抽取、计数、语言与资源上限见随包 docs/feature/documentation-quality/policy.md 的「受控写作规则」与「写作 JSON 结果」。

非 v3 政策是无效输入，返回 InvalidWritingPolicy。show 返回原文和 digest，修改使用 writing set 的完整 CAS；无法解码的 journal 保持阻断。WritingBudgetExceeded 的 complete 为 false，不把截断报告当成功。词法 finding 陈述词面观察，不宣称符合 ASD-STE100，也不分发其原文或词典。
