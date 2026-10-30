---
format: concord.document/v1
id: evolve-constitution
title: 功能开发遵守并修订项目宪法
createdAt: 2026-09-14T13:53:34.662Z
kind: use-case
feature: docs/feature/project-onboarding/README.md
---

# 功能开发遵守并修订项目宪法

## 用户目标

维护者和 Agent 在实现功能时遵守项目共同规则，在依据某条规则的句子旁链接它，并把新发现的通用约束写成可追溯的宪法修订。工具能回答“哪些地方依据这条规则”，并在规则被删除时阻止留下断开的引用。

## 起始状态

- 项目已初始化，`docs/constitution.md` 为 `concord.constitution/v2`，状态为 active。

## 完整路径

1. 读取宪法，找到适用的条款与款。 {#read-clauses}

   条款是带 ID 的 H2 标题，款是条款下带 ID 的根有序列表项：

   ```markdown
   ## C-007 尊重协作与外部操作授权 {#c-007}

   1. 保留其他任务的改动，控制写入范围。 {#c-007-1}
   4. 凭据只从环境变量或外部工具登录态读取，不写入 docs、配置、缓存、证据、HTTP 响应或诊断。 {#c-007-4}
   ```

   条款 ID 为 `c-` 加 001 至 999 的三位数，标题以对应的大写标签开头；款 ID 为条款 ID 加连字符与一段小写字母、数字和单连字符。总则写 `## 总则 {#general}`，其款写 `{#general-<name>}`。active 宪法中每个条款与款都有 ID，全文唯一，并与标题 slug 共用命名空间；没有显式 ID 的标题 slug 不能作为引用目标。frontmatter、代码、HTML 与注释中的 `{#...}` 不产生 ID。

   ID 一经采用不改名、不复用。插入或重排款不改变已有 ID，新款取未使用的 ID。

2. 在依据规则的句子旁链接它。 {#link-clause}

   ```markdown
   错误消息不含凭据与环境变量值（[C-007](../../constitution.md#c-007-4)）。
   ```

   `docs/` 下除 `docs/_template/` 与宪法本身外的所有 Markdown 正文都可以链接，包括附页、Issue 与 Research；Memory 不计入。只计入行内链接；图片、引用式链接、HTML、代码与注释中的链接不计入。“第 N 款”这类文字不建立关系。

   没有 scheme、不以 `/` 开头的链接才参与解析：百分号解码后相对所在文件解析并规范化，结果为 `docs/constitution.md` 才是宪法链接。不读取网络，不跟随 symlink。不带 fragment 的宪法链接不建立关系，也不产生 finding。指向款的引用同时归属其条款。页面不必链接任何条款。

3. 检查引用。 {#check-links}

   ```sh
   concord --json check
   ```

   指向不存在的 ID 时，退出 1（预期输出）：

   ```json
   {"operation":"check","ok":false,"complete":true,"findings":[{"code":"AnchorNotFound","path":"docs/feature/cart/README.md","line":12,"message":"Constitution clause c-099 does not exist","category":"relation"}]}
   ```

4. 查看哪些地方依据一条规则。 {#show-references}

   ```sh
   concord --json constitution show
   ```

   预期输出（省略 `source`、`metadata` 与 `body`）：

   ```json
   {
     "operation": "constitution-show",
     "constitution": {"path": "docs/constitution.md", "digest": "sha256:...", "clauses": [{"id": "c-007", "title": "尊重协作与外部操作授权", "paragraphs": ["c-007-1", "c-007-2", "c-007-3", "c-007-4"]}]},
     "references": [{"path": "docs/design/lsp-integration/LIMITS.md", "line": 21, "clause": "c-007", "paragraph": "c-007-4"}],
     "complete": true
   }
   ```

   `source`、`metadata`、`body` 与 `digest` 随结果返回；`clauses` 按正文顺序列出，总则的 `id` 为 `general`。`references` 每次出现一项，按 `path`、`line` 排序。指向条款而非款时 `paragraph` 为 `null`，指向总则时 `clause` 为 `general`。`trace` 的 `constitution` 边从页面指向 `docs/constitution.md#<id>`；`review render` 按条款列出引用位置。

5. 修订宪法。 {#amend}

   ```sh
   concord constitution amend --body ./constitution.md --reason "..." --impact "..." --source docs/design/<id>/README.md --expected-digest sha256:...
   ```

   正文只维护当前规则。理由、来源与影响写入一条新的 Decision Memory，与正文在同一次发布中提交；输出的 `memory` 字段给出它的路径。

## 格式与状态

宪法的 frontmatter 只有 `format: concord.constitution/v3` 与 `status`（draft 或 active）。宪法是声明式的当前规则，不保存采用日期、修订日期或修订历史，不设语义版本号；整文件 digest 是并发前像。

采用与每次修订各写入一条 Decision Memory：标题概括修订，正文写适用范围、理由与影响，来源列为仓库相对引用，状态直接为 current，并 promote 到受影响的条款或款（`docs/constitution.md#c-NNN-K`）。修订历史由 `concord memory list` 按这些 promotion 派生，逐字差异由 Git 提供。Memory 来源为 read-only 或没有可写来源时，adopt 与 amend 返回 `MemoryWriteUnavailable`，不改写宪法。

init 默认生成 draft，正文说明尚未采用项目原则，非 TTY 同样如此。提供正文不会自动变为 active。

| 命令 | 前提 | 结果 |
| --- | --- | --- |
| `constitution initialize` | 既有项目尚无宪法 | 在配置中声明宪法并创建 draft；已存在时返回 `ConstitutionExists` |
| `constitution adopt` | draft，正文至少一个带 ID 的条款，理由与影响非空 | 变为 active，写入采用的 Decision Memory；已 active 返回 `ConstitutionAlreadyActive` |
| `constitution amend` | active，理由与影响非空 | 改写正文，写入修订的 Decision Memory；draft 返回 `ConstitutionNotActive` |

adopt 与 amend 都要求 `--expected-digest` 等于当前摘要，否则返回 `PreimageChanged`。普通正文编辑不能改变状态，也不产生 Decision Memory。宪法未配置时 `doctor` 提示 `constitution initialize`；宪法缺失或状态无效不阻碍 `recover`。结构合法不等于治理通过。

## 结果

| 错误 | 触发条件 |
| --- | --- |
| `AnchorNotFound` | 链接的 fragment 不是条款、款或总则的 ID |
| `ConstitutionLinkInvalid` | 宪法链接带 query，或百分号编码无法解码 |
| `ConstitutionClauseInvalid` | 宪法中条款或款缺少 ID、ID 格式不对、重复，或标签与 ID 不一致 |
| `ConstitutionClauseReferenced` | `amend` 或 `adopt` 删除仍被链接的 ID；输出列出引用位置，不写入 |
| `ConstitutionMigrationRequired` | 宪法仍是 v1 或 v2，或 Feature、Design 元数据仍有 `constitutionRefs` |

`amend` 按候选正文校验引用，同次删除一款及宪法内指向它的链接可以通过。要撤销一款时，先改写引用它的页面（Issue 用 `issue edit`），再删除该款。任何纳入范围的文件无法读取时，`check` 与 `constitution show` 返回 `complete: false`，`amend` 与 `adopt` 拒绝执行。

`check` 只校验引用的结构，不判断语义是否合规。宪法中的列表 ID 不是 Use Case 步骤，不进入 `use-case steps` 与 `trace gaps`。

## 迁移旧格式

```sh
concord --dry-run constitution migrate
concord --json constitution migrate
```

预期输出：

```json
{"operation":"constitution-migrate","dryRun":false,"changedPaths":["docs/constitution.md","docs/feature/local-sdlc/README.md"],"clauses":15,"paragraphs":66,"movedReferences":248}
```

- 宪法：`<a id="c-NNN"></a>` 并入下一行标题，写成 `{#c-NNN}`；第 K 款补 `{#c-NNN-K}`；`## 总则` 补 `{#general}`。
- v2 的修订记录：`ratifiedAt` 与每条 `amendments` 各转为一条 Decision Memory，日期写入正文，`reason`、`sources` 与 `impact` 原样保留，ID 为 `constitution-<date>-<序号>`；之后删除 `ratifiedAt`、`amendedAt` 与 `amendments`，format 改为 v3。同一次迁移在一个发布中写入宪法与全部 Memory，再次运行时 `changedPaths` 为空。
- owner：删除 Feature 与 Design 元数据中的 `constitutionRefs`（含空数组），在正文唯一的 `## Constitution` 节末尾为每个条款追加一行 `- [C-NNN](<相对路径>#c-NNN)`，没有该节时在正文末尾新建，已有同目标链接时不重复。
- 有未完成写入、待改文件无法解码、多个 `## Constitution` 节或该标题 slug 与已有 ID 冲突时，返回具名错误（`RecoveryRequired`、原解码错误或 `ConstitutionMigrationConflict`），不写任何文件；`--dry-run` 执行同样的预检与规划。
- 中断时保留恢复现场，普通命令返回 `RecoveryRequired`，`concord recover` 按前后像完成或回退。已迁移的仓库再次运行时 `changedPaths` 为空；宪法已是 v2 而仍有 owner 带 `constitutionRefs` 时只迁移这些 owner。
- 迁移只转换格式，不是修订；作者之后把 `## Constitution` 节中的链接移到依据它的句子旁。
- 迁移后的仓库只支持提供 `constitution migrate` 的 CLI 版本。

## Web 修订

Web 文档页可以进入宪法正文编辑，通过 `constitution.adopt` 与 `constitution.amend` action 提交正文、理由、影响、可选来源与当前摘要。状态与 Decision Memory 由领域操作维护。理由或影响未填时保留草稿，导航、外部改写和保存失败遵守草稿保护。

CLI、Web 与 action 使用同一宪法 Schema，严格拒绝额外字段。读取不重写文件。

## 可观察验收

- 在一款前插入新款并修订后，指向原款的链接仍有效；新款取未使用的 ID。
- Use Case 与附页各链接 `#c-007-4`，`constitution show` 列出两处的路径、行号、条款与款。
- 路径或 fragment 的百分号编码无法解码时，`check` 退出 1 并带路径与行号，`constitution show` 的 `complete` 为 false，amend 与 adopt 拒绝执行。
- 删除仍被 Issue 链接的款时 amend 拒绝并列出位置；用 `issue edit` 改链接后可以删除。
- amend 之后宪法 frontmatter 只有 `format` 与 `status`；新 Decision Memory 为 current，promote 到修改的款，`memory list` 能按条款列出全部修订。Memory 写入失败时宪法不变，二者不出现只写一半的状态。
- v2 宪法迁移后，原有每条修订都能作为 Decision Memory 找到，理由、来源与影响逐字相同。
- 迁移在第一个文件替换后中断，保留 journal 与已替换文件，`recover` 完成或回退。

## Spec 来源

- 条款写法：`docs/constitution.md` 的总则
- 依据关系写在依据它的句子旁，附页同样可以声明（[决策依据](../../../design/constitution-structure/DECISION.md)）
- 实现边界：[架构](../architecture.md#宪法)
