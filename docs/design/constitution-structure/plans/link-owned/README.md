# 链接拥有依据关系

## Problem

依据关系应写在依据它的那句话旁，每个纳入范围的链接都被校验。

## Core Mental Model

条款与款使用全仓库统一的 `{#id}` 语法。纳入范围的行内 Markdown 链接是依据关系的唯一来源，每次出现都是一条引用位置；按页面与目标去重后得到依据关系。`constitutionRefs` 取消。`check` 校验所有纳入范围的链接，`constitution show` 从中派生反向视图。

### 条款与款的 ID

- 条款是 H2 标题，形如 `## C-011 关联由源码声明拥有，指向最小完整范围 {#c-011}`。ID 为 `c-` 加 001 至 999 的三位数字，标题以对应的大写标签开头。
- 款是条款下根有序列表项，第一段末尾写 ` {#c-011-1}`。ID 为条款 ID 加连字符，再加一段小写字母、数字与单连字符。迁移生成数字段；新增的款可以用数字或语义名称。
- ID 一经采用不改名、不复用。插入或重排款不改变已有 ID；新款取未使用的 ID。
- 总则使用 `## 总则 {#general}`，其中各款带 `{#general-<name>}`。`general` 与 `general-*` 可以被引用，在输出中 `clause` 为 `general`。
- 生效的宪法中，每个条款与每一款都必须有 ID，全文唯一，并与标题 slug 及其连字符别名共用命名空间。没有显式 ID 的标题 slug 只用于导航，不能作为引用目标。
- YAML frontmatter、代码块、行内代码、HTML 块与注释、缩进代码中的 `{#...}` 不产生 ID。
- 宪法中的列表 ID 不是 Use Case 步骤，不产生 `InvalidStepPosition`，不进入 `use-case steps` 与 `trace gaps`。

不符合以上规则时返回 `ConstitutionClauseInvalid`，指出行号与原因。

### 引用的范围与解析

- 来源：`docs/` 下所有 Markdown 页面的正文，排除 `docs/_template/` 与 `docs/constitution.md` 本身。Issue 与 Research 页面也计入，它们可以通过 `issue edit` 与 `author set` 修改。`docs/` 外的 Memory 不计入。
- 只取 Markdown 语法树中的行内 `link` 节点。图片、引用式链接、HTML 中的链接，以及 frontmatter、代码与注释中的文本都不计入。
- 目标解析顺序：没有 scheme、不以 `/` 开头的 URL 才参与；百分号解码后相对所在文件解析，规范化 `.` 与 `..`；结果等于 `docs/constitution.md` 才是宪法链接。越出仓库或指向其它文件的链接不是宪法链接。不读取网络，不跟随 symlink。
- 路径部分的百分号编码无法解码时，无法确定是否指向宪法，返回 `ConstitutionLinkInvalid`。指向宪法、但 fragment 无法解码时同样返回 `ConstitutionLinkInvalid`。这两种情况都使 `constitution show` 的 `complete` 为 false，`amend` 与 `adopt` 拒绝执行，不当作未发现引用。
- 宪法链接带 query 时返回 `ConstitutionLinkInvalid`。不带 fragment 时不建立关系，也不产生 finding。fragment 不是条款、款或总则 ID 时，返回 `AnchorNotFound`。两者类别都是 `relation`，带路径与行号，`check` 退出 1。
- 指向款的引用同时归属其条款。Feature 不要求链接任何条款。
- 任何纳入范围的文件缺失、不可读或在读取期间改变时，`check` 返回 `complete: false`；`constitution show` 返回 `complete: false`；`amend` 与 `adopt` 拒绝执行。

### 反向视图

`concord --json constitution show` 保留现有 `constitution.path`、`source`、`metadata`、`body` 与 `digest`，其余字段的变化：

| 字段 | 现在 | 修订后 |
| --- | --- | --- |
| `constitution.anchors` | 条款 ID 字符串数组 | 删除，由 `constitution.clauses` 取代 |
| `constitution.clauses` | 不存在 | 每项为 `{"id","title","paragraphs":[...]}`，按正文顺序；总则为 `{"id":"general",...}` |
| `affected` | 带 `constitutionRefs` 的 owner 列表 | 删除，由 `references` 取代 |
| `references` | 不存在 | 每次出现一项 `{"path","line","clause","paragraph"}`，指向条款时 `paragraph` 为 `null`；按 path、line 排序，同一行多次出现分别列出 |
| `complete` | 不存在 | 布尔值，见上节 |

```json
{
  "operation": "constitution-show",
  "constitution": {"path": "docs/constitution.md", "digest": "sha256:...", "clauses": [{"id": "c-011", "title": "关联由源码声明拥有，指向最小完整范围", "paragraphs": ["c-011-1", "c-011-2"]}]},
  "references": [{"path": "docs/design/lsp-integration/LIMITS.md", "line": 21, "clause": "c-007", "paragraph": "c-007-4"}],
  "complete": true
}
```

`trace` 的 `constitution` 边从页面指向 `docs/constitution.md#<id>`。`review render` 按条款列出引用位置。最终输出与错误先写进 `project-onboarding` 的 Use Case 与 CLI 页，再实现。

### 修订保护

`constitution amend` 与 `adopt` 先解析候选正文，再用候选 ID 集合校验全部引用。删除仍被引用的 ID 时返回 `ConstitutionClauseReferenced`，列出引用位置，不写入。宪法内部的链接按候选正文校验，所以同次删除一款及指向它的内部链接可以通过。作者要撤销一款时，先改写引用它的页面，包括用 `issue edit` 改 Issue，再删除该款。

### 取消的接口

| 接口 | 修订后的结果 |
| --- | --- |
| Feature 与 Design 元数据的 `constitutionRefs` | 键存在（包括空数组）时返回 `ConstitutionMigrationRequired`，指出路径；其它未知字段仍按现有严格解码报错 |
| `feature create`、`design create` 的 `--constitution-ref` | 未知选项，返回 `InvalidInput`，退出 1 |
| `document.metadata` action 的 `constitutionRefs` | 严格解码拒绝，返回 `InvalidInput` |
| 模板、init 指引与随包 skill 中要求记录 `constitutionRefs` 的文字 | 改为“在依据规则的句子旁链接条款” |

文档格式保持 `concord.document/v1`：迁移后的 owner 只是少了一个可选字段，不需要新格式号。宪法格式改为 `concord.constitution/v2`。迁移后的仓库只支持新版 CLI。旧版中读取宪法的入口会拒绝 v2，其它入口可能仍可运行，但不提供新的依据关系，这种组合不受支持。回退使用迁移前的文件与现场。

### 迁移

`concord constitution migrate` 在加载普通 owner 图之前路由，使用只供这条命令的严格 v1 读取器。普通运行时不读取旧格式。

1. 宪法：每个 `<a id="c-NNN"></a>` 行并入下一行 H2 标题，写成 ` {#c-NNN}`；条款下第 K 个根有序列表项补 ` {#c-NNN-K}`；`## 总则` 补 ` {#general}`。修订记录原样保留。
2. owner：删除 `constitutionRefs` 键。数组非空时，在正文中唯一的 `## Constitution` 节末尾为每个条款追加一行 `- [C-NNN](<相对路径>#c-NNN)`；没有该节时在正文末尾新建。已有同目标链接时不重复添加。
3. 预检：存在未完成 journal、任一待改文件无法严格解码、某个 owner 有多个 `## Constitution` 节，或该标题 slug 与已有 ID 冲突时，返回具名错误（`RecoveryRequired`、原解码错误或 `ConstitutionMigrationConflict`），不写任何文件。
4. 发布：全部变更写入一个 journal，再逐文件替换。中断时保留 journal 与已替换的文件，普通命令返回 `RecoveryRequired`。新版 `concord recover` 按 journal 的前后像完成或回退，不加载 owner 图，遇到未知编辑时拒绝。
5. 重复执行：已全部是新格式时返回空的 `changedPaths`。宪法已是 v2 但仍有 owner 带 `constitutionRefs` 时，只迁移这些 owner。
6. `--dry-run` 执行同样的预检与规划，不写文件。

```json
{"operation":"constitution-migrate","dryRun":false,"changedPaths":["docs/constitution.md","docs/feature/local-sdlc/README.md"],"clauses":15,"paragraphs":66,"movedReferences":248}
```

迁移只转换格式，不是治理修订。`## Constitution` 节是保真过渡，作者之后把链接移到依据它的句子旁。

### 迁移验收

- 关系按 `(path, clause)` 去重。迁移前每个 `constitutionRefs` 条目 `(owner, c-NNN)`，迁移后在同一 owner 正文中都有指向该条款的链接，没有遗漏。
- 迁移后的关系集合包含上述投射，另含已有正文链接、附页链接与款级链接；不要求与迁移前的元数据集合相等。
- 例：local-sdlc README 元数据有 c-011，正文原本没有链接，迁移后 `## Constitution` 节有一行 c-011 链接，该 owner 贡献 1 条关系。lsp-integration 的 LIMITS 附页原有 c-007 链接，迁移不改它，它贡献 1 条附页关系。

### 条款写法

总则新增“条款写法”：

```markdown
1. 每条款陈述一项跨功能规则，标题就是规则本身。 {#general-one-rule}
2. 每款一项可审阅的规则：义务、禁止或许可。未写“必须”“不得”的规范性陈述同样有约束力。 {#general-paragraph}
3. 条款写约束，不写达成约束的机制。明确采用的技术栈、依赖固定、信任与资源边界属于约束；实现方式写在 architecture 页，理由、来源与影响写在修订记录，过程写在 Memory。 {#general-rules-only}
4. 用现行句式，不描述与过去的差别。 {#general-present}
5. 依据某条规则的句子旁写指向其 ID 的链接，不用“第 N 款”这类序号文字。 {#general-link}
```

同一规则写进 `docs/_template/constitution.md` 与 `concord --skill document`。

## Scope

- 实现以上语法、引用解析、校验、输出、保护与迁移；删除取消的接口；先更新 `project-onboarding` 契约。
- 自举：按 Design README 的执行顺序关闭 Problem、迁移本仓库，再把 36 处“第 N 款”文字逐处核对后改为链接。宪法中的技术约束保留；只有作者明确撤销某项约束时才作为修订列出原义务与影响。
- 不改变测试标记、代码声明、Memory 与 Issue 的格式。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-运行时只接受当前格式) | satisfied | 旧宪法与旧元数据返回 `ConstitutionMigrationRequired`；只有 `constitution migrate` 使用专用 v1 读取器，普通运行时不读取旧格式 | 本页“迁移”与“取消的接口” |
| [L2](../../LIMITS.md#l2-条款身份与修订历史保持) | satisfied | `<a id>` 的值原样成为标题 ID；ID 不改名、不复用；修订记录不改动 | 本页“条款与款的 ID”“迁移”第 1 项 |
| [L3](../../LIMITS.md#l3-迁移遵守写入契约) | satisfied | 预检失败零写入；发布中断保留 journal，由新版 `recover` 按前后像处理 | 本页“迁移”第 3、4 项，CASES C14 |
| [L4](../../LIMITS.md#l4-破坏性变更经独立审查) | satisfied | 取消三处接口并改变 `constitution show` 输出，以对照表列出；独立 reviewer 两轮审查，第二轮结论 approve-with-changes，三项修正已采纳 | 独立审查第二轮结论与 CASES C8、C21 |
| [L5](../../LIMITS.md#l5-不改变测试与代码关联) | satisfied | 只改变宪法与 Feature、Design 元数据；宪法列表 ID 不成为步骤 | CASES C20 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-引用精确到款且稳定) | satisfied | 款 ID 与序号无关，不改名、不复用 | CASES C1 |
| [G2](../../GOALS.md#g2-断开的引用被-check-发现) | satisfied | 纳入范围的行内宪法链接都校验；amend 按候选正文拒绝删除仍被引用的 ID | CASES C2、C7、C13、C21 |
| [G3](../../GOALS.md#g3-依据关系定位到句子且只声明一次) | satisfied | 引用位置带页面与行，附页同样适用；元数据字段取消，链接是唯一来源 | CASES C3、C12 |
| [G4](../../GOALS.md#g4-宪法只写规则) | partial | 条款写法可以逐条审阅，但“一款一项规则”和“约束与机制的区别”是语义判断，词面检查不能证明；宪法中明确采用的技术约束会出现引擎与库名，禁用这些词会误报 | CASES C8 由审阅判定 |
| [G5](../../GOALS.md#g5-用-concord-自己完成迁移与验收) | satisfied | 固定签发工具在迁移前签发 red 与 green；迁移由新 CLI 完成 | Design README“自举” |
