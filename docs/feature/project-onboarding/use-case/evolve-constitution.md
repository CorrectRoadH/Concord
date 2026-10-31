# 功能开发遵守并修订项目宪法

## 用户目标

维护者和 Agent 在实现功能时遵守项目共同规则，在依据某条规则的句子旁链接它，并把新发现的通用约束写成可追溯的宪法修订。工具能回答“哪些地方依据这条规则”，并在规则被删除时阻止留下断开的引用。

## 起始状态

- 项目已初始化，`docs/constitution.md` 的 `status` 为 active。

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

   Spec 页面中的链接指向不存在的 ID 时，退出 1（预期输出）：

   ```json
   {"operation":"check","ok":false,"complete":true,"findings":[{"code":"AnchorNotFound","path":"docs/feature/cart/README.md","line":12,"message":"Constitution clause c-099 does not exist","category":"relation"}]}
   ```

   Design 与 Research 是记录，按写下时的含义理解：其中指向已不存在的 ID 的链接不报告 `AnchorNotFound`，也不阻止删除该 ID。修订记录 Memory 的 `amends` 同样如此。Issue 是仍在处理的工作项，删除它引用的 ID 前先改写 Issue。

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

   `source`、`metadata`、`body` 与 `digest` 随结果返回；`clauses` 按正文顺序列出，总则的 `id` 为 `general`。`references` 每次出现一项，按 `path`、`line` 排序。指向条款而非款时 `paragraph` 为 `null`，指向总则时 `clause` 为 `general`。`trace` 的 `constitution` 边从页面指向 `docs/constitution.md#<id>`；`review` 按条款列出引用位置。

5. 修订宪法。 {#amend}

   直接编辑 `docs/constitution.md`，并在同一变化中新建一条 Decision Memory：

   ```markdown
   ---
   type: decision
   status: current
   relations:
     - role: amends
       target: docs/constitution.md#c-007-4
   ---

   # 凭据不进入诊断

   适用范围、理由与影响……
   ```

   也可以用助手命令一次写入二者：

   ```sh
   concord constitution amend --body ./constitution.md --reason "..." --impact "..." --source docs/design/<id>/README.md --if-unchanged sha256:...
   ```

   正文只维护当前规则。助手把理由、来源与影响写入一条新的 Decision Memory，与正文在同一次发布中提交；输出的 `memory` 字段给出它的路径。

6. 提交前检查本次变化。 {#check-amendment}

   ```sh
   concord --json check --since master
   ```

   active 宪法中有条款或款改变、而本次变化中没有 `type: decision` 的 Memory 以 `amends` 指向它们时，`check --since` 报告 finding 并退出 1。CI 对每个变更运行这条检查。

## 格式与状态

宪法的 frontmatter 只有 `status`（draft 或 active）；status 是采用授权的边界。宪法是声明式的当前规则，不保存采用日期、修订日期或修订历史，不设语义版本号（[只写当前声明](../../../document-model.md#只写当前声明)）；整文件 digest 是并发前像。

采用与每次修订各对应一条 Decision Memory：`type: decision`、`status: current`，以 `amends` 关系指向受影响的条款或款（`docs/constitution.md#c-NNN-K`）；标题概括修订，正文写适用范围、理由与影响，来源列为仓库相对引用。Memory 位于 `memory/`。按条款检索修订从这些 `amends` 关系派生，逐字差异由 Git 提供（[决策依据](../../../design/sdd-core-model/DECISION.md)）。

宪法文件存在即启用其规则；不存在时 `doctor` 提示创建。init 默认生成 draft，正文说明尚未采用项目原则，非 TTY 同样如此。提供正文不会自动变为 active。

宪法可以直接编辑，包括 status 与正文。`check --since <base>` 对照基线检查：active 宪法中改变的条款与款必须有本次变化中的 Decision Memory 以 `amends` 指向。由 draft 变为 active 时，这条 Memory 以 `amends` 指向整份 `docs/constitution.md`，覆盖全部条款。draft 宪法的编辑不要求 Decision Memory。助手命令执行同样的检查并一次写入宪法与 Memory：

| 命令 | 前提 | 结果 |
| --- | --- | --- |
| `constitution adopt` | draft，正文至少一个带 ID 的条款，理由与影响非空 | 变为 active，写入采用的 Decision Memory；已 active 返回 `ConstitutionAlreadyActive` |
| `constitution amend` | active，理由与影响非空 | 改写正文，写入修订的 Decision Memory；draft 返回 `ConstitutionNotActive` |

adopt 与 amend 都要求 `--if-unchanged` 等于当前摘要，否则返回 `FileChangedSinceRead`。宪法缺失或状态无效不阻碍 `recover`。结构合法不等于治理通过。

## 结果

| 错误 | 触发条件 |
| --- | --- |
| `AnchorNotFound` | 链接的 fragment 不是条款、款或总则的 ID |
| `ConstitutionLinkInvalid` | 宪法链接带 query，或百分号编码无法解码 |
| `ConstitutionClauseInvalid` | 宪法中条款或款缺少 ID、ID 格式不对、重复，或标签与 ID 不一致 |
| `ConstitutionClauseReferenced` | `amend` 或 `adopt` 删除仍被 Spec 页面链接的 ID；输出列出引用位置，不写入 |

`amend` 按候选正文校验引用，同次删除一款及宪法内指向它的链接可以通过。要撤销一款时，先改写引用它的 Spec 页面，再删除该款；直接编辑删除仍被 Spec 页面链接的款时，`check` 报告 `AnchorNotFound`。任何纳入范围的文件无法读取时，`check` 与 `constitution show` 返回 `complete: false`，`amend` 与 `adopt` 拒绝执行。

`check` 只校验引用的结构，不判断语义是否合规。宪法中的列表 ID 不是 Use Case 步骤，不进入 `use-case steps` 与 `trace gaps`。

## Web 修订

Web 文档页可以进入宪法正文编辑，通过 `constitution.adopt` 与 `constitution.amend` action 提交正文、理由、影响、可选来源与当前摘要，状态与 Decision Memory 由这两个操作一并写入。修订表单是 Web 提供的交互，通用保存同样可以保存宪法正文，变化是否合法由 `check --since` 判断，保存规则见 [Web 工作台的保存](../../web-workbench/README.md#自动保存)。理由或影响未填时保留草稿，导航、外部改写和保存失败遵守草稿保护。

CLI、Web 与 action 使用同一宪法 Schema，严格拒绝额外字段。读取不重写文件。

## 可观察验收

- 在一款前插入新款并修订后，指向原款的链接仍有效；新款取未使用的 ID。
- Use Case 与附页各链接 `#c-007-4`，`constitution show` 列出两处的路径、行号、条款与款。
- 路径或 fragment 的百分号编码无法解码时，`check` 退出 1 并带路径与行号，`constitution show` 的 `complete` 为 false，amend 与 adopt 拒绝执行。
- 删除仍被 Issue 链接的款时 amend 拒绝并列出位置；直接编辑 Issue 改链接后可以删除。
- amend 之后宪法 frontmatter 只有 `status`；新 Decision Memory 为 current，以 `amends` 指向修改的款，按条款能列出全部修订。Memory 写入失败时宪法不变，二者不出现只写一半的状态。
- 直接编辑 active 宪法的一款而不新建 Decision Memory，`check --since <base>` 报告 finding 并退出 1；同一变化中加入以 `amends` 指向该款的 Decision Memory 后通过。只编辑 draft 宪法时不要求 Memory。

## Spec 来源

- 条款写法：`docs/constitution.md` 的总则
- 依据关系写在依据它的句子旁，附页同样可以声明（[决策依据](../../../design/constitution-structure/DECISION.md)）
- 实现边界：[架构](../architecture.md#宪法)
