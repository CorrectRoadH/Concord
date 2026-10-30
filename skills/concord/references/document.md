# Spec 与文档

已采用的当前目标写入 Feature，叶子用户路径写入 Use Case；设计未完成或暂不实现的方向写入 Roadmap（与 Feature 同体裁），多方案比较写入 Design，带来源的研究输入写入 Research，仓库测试与维护机制写入 Engineering。

Spec 正文采用声明式表达：写产品必须具备的行为、边界与验收，不写“这轮做了什么”、开发流水账、实施进度或临时计划。用户操作流程、状态迁移和验收步骤可以保留。排障经过与交付经验写进 `memory/`；待调查观察写进 `docs/issues/`。

## 布局与创建

Feature 目录包含 README（必需）、`use-case/`、`architecture.md`、示例页 `cli.md` 或 `library.md`，其它页面是支持页面。Engineering 与 Roadmap 的页面结构相同。Spec、Roadmap、Research 与 Design 没有 frontmatter：身份是仓库相对路径，名称是正文唯一的一级标题（代码块中的标题不计），Use Case 属于所在目录的 Feature。

直接创建目录与文件即可。`concord new` 按随包模板创建，页面在创建时选择，README 必需，其余可选：

```sh
concord new feature login
concord new use-case expired-token
concord new design session-store
concord new research auth-input
```

类别、页面选择与所属 Feature 的参数以 `concord new --help` 为准。名称允许 Unicode 字母、组合标记和数字，可用单连字符分隔，保留原样，不翻译或自动更改大小写；禁止路径分隔符、空白和路径穿越。用 `concord list [类别]` 发现文档，用 `concord show <路径或选择器>` 读取文档及其关系、测试与实现；短选择器在同类中有歧义时具名拒绝，改写完整路径。

图示按表达需要选择：Mermaid 描述结构与流程，`p5` 代码块解释动画、连续变化和交互。图示旁保留结论与关键条件，未运行时也能理解 Spec。p5 使用完整实例函数或简写 `p.setup` / `p.draw`，外部入口相对所在 Markdown；扩展库统一配置在项目 `p5.libraries`，不要在代码块声明库或插入 CDN script。可复制示例与沙箱边界见 `concord --skill view`。

Research 的正文自由组织；观察日期与来源写在模板固定的来源小节，见 `concord template show research`。

## 写作指南

先问读者要回答什么，再决定写在哪一页：

| 读者的问题 | 写在 | 写法 |
| --- | --- | --- |
| 功能对使用者做什么 | Feature README | 问题、概念、范围与非目标 |
| 一个目标怎样完成 | Use Case | 用户目标、起始状态、带 `{#id}` 的完整路径、结果、Spec 来源 |
| 命令或 API 怎样调用、返回什么 | cli、library | 完整调用、人读输出、`--json` 输出、退出码、具名错误、最小示例 |
| 它是怎么实现的 | architecture | 实体归属、数据流、不变量、失败阶段、资源生命周期 |
| 为什么这样选 | Design | 目标、约束、候选与裁决；裁决后只作记录 |
| 排障经过、根因、经验 | Memory | `memory/<id>.md` |
| 缺陷、请求与待调查的观察 | Issue | `docs/issues/<id>.md` |

行为页的规范性陈述要能被测试断言。已实现的命令在临时仓库实际运行，复制输出，把每次运行都会变化的摘要和时间戳写成省略号或说明；尚未实现时标为预期输出，交付验收再核对实际运行，运行记录写进 Memory。错误写成表格，列出错误码和触发条件。`--json` 字段、错误码和退出码属于公开 Spec；人读输出帮助理解，不保证逐字稳定。同一输出或错误只在一个页面定义，其它页面链接过去。

行为页不写内部模块、内部数据结构、调用链、缓存或存储引擎；公开的输入输出结构、协议和可观察的恢复保证留在行为页。出现这些词时，把那段移到 architecture 页，行为页只保留使用者能观察到的保证，例如“删除缓存后结论不变”。architecture 页不重新定义行为；只改实现时只改 architecture 页。

正文写现行规则，不写“目前”“已实现”“这次改了什么”，不点名已删除的接口。Use Case 主流程的步骤加 `{#id}`，测试和实现可以指向具体步骤。路径与 anchor 是关系身份，链接目标写仓库相对路径或相对链接。

## 宪法

依据宪法的句子旁写指向条款或款 ID 的行内链接，例如 `错误消息不含凭据（[C-007](../../constitution.md#c-007-4)）`，不用“第 N 款”这类序号文字。docs/ 下除 `docs/_template/` 与宪法本身外的所有 Markdown 都可以链接；图片、引用式链接、代码与注释中的链接不计入。`concord check` 对指向不存在 ID 的链接报告 `AnchorNotFound`，对带 query 或无法解码的宪法链接报告 `ConstitutionLinkInvalid`；`concord constitution show` 从这些链接派生反向视图，不声称语义合规。

宪法条款写成 `## C-001 规则本身 {#c-001}`，款是条款下根有序列表项，第一段末尾写 ` {#c-001-1}`；总则用 `## 总则 {#general}`，其款用 `{#general-<name>}`。ID 一经采用不改名、不复用。每条款一项跨功能规则，标题就是规则；每款一项可审阅的义务、禁止或许可；条款写约束，不写达成约束的机制；用现行句式。

宪法 frontmatter 只有 `status`（draft 或 active），它是采用授权的边界。宪法可以直接编辑，`constitution adopt` 与 `constitution amend` 是助手；每次采用或修订，同一变化中都要有一条 `type: decision` 的 Memory 以 `amends` 关系指向受影响的条款与款，正文写理由、来源与影响，`check --since` 检查这一点。按条款检索修订从这些关系派生。

## Design 与采用

了解现行行为只读 Feature、Use Case、cli、library、architecture 与 engineering 页；Design 只在重新审视某项决策时读取。

Design 目录有 README、GOALS、LIMITS、CASES、DECISION 与 `plans/<候选>/`；候选就是 `plans/` 下的子目录，每个候选是一个完整的 Feature 设计包。GOALS/LIMITS 用 `## G1: 标题`、`## L1: 标题` 定义稳定条目；每个候选 README 的 `## Goals`、`## Limits` 各用四列表格逐项写出要求链接、状态、机制/缺口和依据。状态支持 satisfied/not-satisfied/pending（满足/不满足/待验证），Goal 另支持 partial（部分满足）。链接例如 `[L1](../../LIMITS.md#l1-offline)`，必须指向实际标题。代码块、HTML 和引用式链接不作为要求回应。

DECISION 的 `## Decision` 只放 `Selected: [sqlite](plans/sqlite/README.md)` 或 `选择 [sqlite](plans/sqlite/README.md)。`；`## Rationale`、`## Rejected Options`、`## Residual Risks` 写真实论证。每个非 satisfied 的已选 Goal 需在 Rationale 单独写 `G1: 接受缺口的理由`。全部候选必须完整回应，所选候选的所有 Limit 必须 satisfied。

```sh
concord check --json
concord design decide session-store --selected sqlite
concord design defer session-store
concord roadmap adopt sessions
```

`design decide` 校验全部候选与 Limits 后写入 `Selected:` 行；直接编辑这一行时，`check` 用同一规则校验。结构通过不代表真实验证。裁决之后，把选中候选中仍适用的规则写进 Feature 的行为页与 architecture 页，Spec 只把 Design 的 README 或 DECISION 链接为依据。链接到候选页、CASES、GOALS 或 LIMITS 时 `concord check` 报告 `SpecDependsOnDesignRecord`。

`roadmap adopt` 把 Roadmap 目录移入 `docs/feature/`，同时改写指向它的链接；目标已存在或采用期间文件发生变化时拒绝。

## 术语与写作政策

全局定义在 `docs/concepts.md`；Feature、Engineering 或其它 docs 子目录可分别放 `concepts.md` 和 `concord-writing.json`。精确文件名与目录决定作用域，`docs/_template` 排除，局部 roots 不得越界。两类文件都可以直接编辑，`check` 校验结构、作用域与被引用的定义；`concepts`、`writing` 命令提供查看与受管写入。

concepts.md 不设版本字段。正文恰好一个一级标题，位于所有概念之前；每个二级标题为 `term {#id}`，term 是唯一纯文本写法，后面的第一个段落是定义，其余是解释。可选 YAML frontmatter 严格只接受直接 imports 和按本文件 ID 分组的 deprecated；只有弃用名派生禁词并建议改为 term。catalog 整份不计为使用，但仍参与写作检查；解释中提及弃用名时放在行内代码里。全项目术语表只读汇总，不写第二份词库。

结构错误为 `InvalidConceptCatalog`，消息带行号；导入悬空为 `DanglingConceptImport`，有效范围同名为 `AmbiguousConceptName`。被其它 catalog imports 引用的定义不能删除或改名。正文可以链接到 `concepts.md#id`；缺失 ID 由 check 报告 relation 类 `AnchorNotFound`。

政策使用 `concord.writing/v3`。根集合用于选文件，祖先规则仍按有效范围应用；省略阈值表示继承，null 表示清除，布尔 false 表示关闭。同名概念和规则冲突保留全部来源，不默默覆盖。作用域、语料与恢复的精确定义见随包 docs/feature/documentation-quality/policy.md。

`concord docs check --json` 自动发现政策与概念；`--rules <path>` 选择受管政策的扫描根，或使用外部只读 profile。报告说明实际范围与输入快照。发现问题退出 1，逐处核对上下文，不机械全仓替换；这不是测试覆盖率或实现证明。

受控规则在 `controlled` 中按叶子合成，null 清除子树，每种语言的词表和 allowIn 整表替换。数值开启长度检查；词法开关默认 false。程序性动作词开关需要有效非空 verbs 表（auto 要求 zh/en）；英文被动候选需要显式 participles。字符长度与受控 token 长度可同时生效。精确抽取、计数、语言与资源上限见随包 docs/feature/documentation-quality/policy.md 的「受控写作规则」与「写作 JSON 结果」。

其它格式的政策是无效输入，返回 `InvalidWritingPolicy`；无法解码的 journal 保持阻断。`WritingBudgetExceeded` 的 complete 为 false，不把截断报告当成功。词法 finding 陈述词面观察，不宣称符合 ASD-STE100，也不分发其原文或词典。
