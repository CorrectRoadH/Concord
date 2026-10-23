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

   ID 一经采用不改名、不复用。插入或重排款不改变已有 ID。

2. 在依据规则的句子旁链接它。 {#link-clause}

   ```markdown
   错误消息不含凭据与环境变量值（[C-007](../../constitution.md#c-007-4)）。
   ```

   `docs/` 下除 `docs/_template/` 与宪法本身外的所有 Markdown 正文都可以链接，包括附页、Issue 与 Research。只计入行内链接；图片、引用式链接、代码与注释中的链接不计入。

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

   `references` 每次出现一项，按 `path`、`line` 排序。指向条款而非款时 `paragraph` 为 `null`，指向总则时 `clause` 为 `general`。

5. 修订宪法。 {#amend}

   ```sh
   concord constitution amend --body ./constitution.md --reason "..." --impact "..." --source docs/design/<id>/README.md --expected-digest sha256:...
   ```

   修订记录追加日期、理由、来源与影响，不覆盖既有历史。正文只维护当前规则。

## 结果

| 错误 | 触发条件 |
| --- | --- |
| `AnchorNotFound` | 链接的 fragment 不是条款、款或总则的 ID |
| `ConstitutionLinkInvalid` | 宪法链接带 query，或百分号编码无法解码 |
| `ConstitutionClauseInvalid` | 宪法中条款或款缺少 ID、ID 格式不对、重复，或标签与 ID 不一致 |
| `ConstitutionClauseReferenced` | `amend` 或 `adopt` 删除仍被链接的 ID；输出列出引用位置，不写入 |
| `ConstitutionMigrationRequired` | 宪法仍是 v1，或 Feature、Design 元数据仍有 `constitutionRefs` |

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

- 宪法：`<a id="c-NNN"></a>` 并入下一行标题，写成 `{#c-NNN}`；第 K 款补 `{#c-NNN-K}`；`## 总则` 补 `{#general}`。修订记录原样保留。
- owner：删除 `constitutionRefs`，在正文唯一的 `## Constitution` 节末尾为每个条款追加一行链接，已有同目标链接时不重复。
- 有未完成写入、待改文件无法解码、多个 `## Constitution` 节或 ID 冲突时，返回具名错误（`RecoveryRequired`、原解码错误或 `ConstitutionMigrationConflict`），不写任何文件。
- 中断时保留恢复现场，`concord recover` 按前后像完成或回退。已迁移的仓库再次运行时 `changedPaths` 为空。
- 迁移后的仓库只支持提供 `constitution migrate` 的 CLI 版本。

## Web 修订

Web 文档页可以进入宪法正文编辑，通过 `constitution.adopt` 与 `constitution.amend` action 提交正文、理由、影响、可选来源与当前摘要。日期、状态和历史由领域操作维护。理由或影响未填时保留草稿，导航、外部改写和保存失败遵守草稿保护。

CLI、Web 与 action 使用同一宪法 Schema，严格拒绝额外字段。读取不重写文件。

## 契约来源

- 条款写法：`docs/constitution.md` 的总则
- 采用方案：[宪法的结构、关联与写法](../../../design/constitution-structure/plans/link-owned/README.md)
