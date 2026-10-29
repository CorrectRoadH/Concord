# markdown-owned

## Problem

每个概念只需要一个写法；定义、解释和指向定义的链接应由同一份 Markdown 来源承载。

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-single-spelling) | satisfied | 概念只有 `term`；弃用名派生禁词并建议改为 `term` | 方案分析 |
| [G2](../../GOALS.md#g2-co-located-explanation) | satisfied | 定义段落与解释同在 `concepts.md`；正文链接 `concepts.md#id` 由 check 校验 | 方案分析 |
| [G3](../../GOALS.md#g3-safe-authoring) | satisfied | `concepts set` 与 Web 源码编辑按原文字节保存，整文件 CAS | 方案分析 |

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-scope-and-identity) | satisfied | 精确文件名 `concepts.md` 与目录决定作用域；身份为 `path#id` | 沿用目录归属方案 |
| [L2](../../LIMITS.md#l2-publication-and-recovery) | satisfied | `set-concepts` 与 `migrate-concepts` 双向校验路径、操作、解析结果和依赖摘要 | 方案分析 |
| [L3](../../LIMITS.md#l3-explicit-transition) | satisfied | 修订 C-001；`concepts migrate` 一次替换全部 JSON catalog | 方案分析 |
| [L4](../../LIMITS.md#l4-strict-structure) | satisfied | 结构规则逐项给出 `InvalidConceptCatalog` 与行号 | 方案分析 |

## 来源与作用域

只识别 docs 下精确命名的 `concepts.md`，排除 `docs/_template` 及任何 `.git`、`node_modules` 路径段。`docs/concepts.md` 是全局 catalog，其它目录的 catalog 作用于其后代文件。

作用域、继承、`imports`、兄弟隔离、歧义诊断和写作政策合成沿用[目录归属方案](../../../scoped-terminology/plans/directory-owned/README.md)，本方案只替换来源格式与名称模型。`concord-writing.json` 保持 JSON，它是规则配置，没有需要解释的正文。

catalog 路径只能由 concepts 工具写入。`author set`、`page set`、`page add` 与 Web 通用保存遇到 catalog 路径时返回 `ManagedConceptCatalog`，并提示改用 `concepts set`。位于 Feature 或 Engineering 包内的 `concepts.md` 不作为该包的附页创建或改写。

## 文件结构

```markdown
---
imports:
  - docs/concepts.md#memory
deprecated:
  issue: [观察, 工单]
---

# 反馈术语

本页定义反馈来源与导入相关的术语。

## Issue {#issue}

等待调查的问题、摩擦或请求，拥有观察描述、调查关联与本地处理状态。

关闭本地 Issue 不等于远端已关闭，也不等于 [Memory](../../concepts.md#memory) 已修复。旧称 `工单` 只出现在行内代码中。

## Connection {#connection}

一个第三方来源的账号与读取范围。
```

### frontmatter

frontmatter 可选；存在时位于文件开头，是 YAML 映射，严格解码，未知字段被拒绝。没有导入和弃用名的 catalog 不写 frontmatter。

| 字段 | 要求 |
| --- | --- |
| `imports` | 可选，`path#id` 列表；path 必须是 catalog 路径，id 为 slug；列表内不重复 |
| `deprecated` | 可选，键为本文件的概念 ID，值为非空的弃用名列表 |

弃用名放在 frontmatter，因为写作检查不扫描 frontmatter。概念正文因此可以只写现行写法。

catalog 不设版本字段。文件名已经区分 `concepts.json` 与 `concepts.md`，迁移检测只看 `concepts.json` 是否存在。格式以后发生不兼容变化时，结构校验返回具名错误，再由显式迁移处理，不预留版本号。

### 正文

1. 正文恰好有一个一级标题，位于所有二级标题之前。一级标题与第一个二级标题之间是页面引言，可以写任意 Markdown。
2. 每个二级标题是一个概念。标题以 ` {#id}` 结尾，ID 匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`。
3. 标题去掉 ID 后的文字是 `term`。`term` 非空，首尾无空白，只能是纯文本，不含行内代码、链接、强调或 HTML。
4. 二级标题后的第一个块必须是段落，即定义。定义可以含链接与行内代码；结构化视图中的 `definition` 取该段落的 Markdown 原文。
5. 定义之后、下一个二级标题以前的内容是解释，可以使用三级及更深的标题和任意块。
6. 没有二级标题的 catalog 是合法的空 catalog。

### 唯一性

- ID 在文件内唯一。
- `term` 在文件内按匹配规则规范化后唯一。
- 弃用名在文件内规范化后唯一，且不等于本文件任何 `term`。
- `deprecated` 的键必须是本文件存在的 ID。

匹配规则沿用现有实现：ASCII 写法忽略大小写并使用词边界，其它写法按字面精确匹配，不依赖 locale。

### 错误

| 错误 | 条件 |
| --- | --- |
| `InvalidConceptCatalog` | frontmatter 缺失或非法、标题或定义结构不合规、唯一性被破坏；消息带行号与原因 |
| `ConceptMigrationRequired` | docs 下存在任何 `concepts.json` |
| `DanglingConceptImport` | `imports` 指向不存在的 catalog 或 ID |
| `AmbiguousConceptName` | 两个在同一范围生效的概念有相同的规范化 `term` |
| `ManagedConceptCatalog` | 非 concepts 工具的写入目标是 catalog 路径 |

## 检查

### 禁词与冲突

每个弃用名在其概念的有效范围内派生一条禁词，建议写法是该概念的 `term`。一个概念的弃用名等于另一个在同一范围生效的概念的 `term`，或写作政策的 `bannedTerms` 禁止了某个生效概念的 `term`，报告现有的 `writingConflict` 并保留双方来源。

### 使用统计

只有 `term` 计为使用，弃用名不证明正确使用。catalog 文件整份不计入任何概念的使用，包括定义与解释。catalog 文件仍按写作政策参与禁词、长度与受控写作检查。

catalog 正文提到弃用名时必须写在行内代码中；行内代码不参与禁词检查，因此不需要额外豁免。

### 正文链接

docs 下 Markdown 正文（排除 `docs/_template/`）中的行内链接，若相对所在文件解析后指向一个已发现的 catalog，就是术语链接。链接的筛选、解码与无效条件沿用[宪法链接的规则](../../../constitution-structure/plans/link-owned/README.md#引用的范围与解析)。

- 带 fragment 时，fragment 必须是该 catalog 的概念 ID，否则 `concord check` 报告 `AnchorNotFound`，类别为 `relation`，带路径与行号。
- 不带 fragment 的链接指向整页，不产生 finding。
- 删除或改名一个仍被正文链接的 ID 不阻止写入，`check` 报告断开的链接。仍被其它 catalog `imports` 引用的 ID 继续阻止删除。
- 链接文字等于 `term` 时照常计为使用；链接本身不计。

## 工具入口

### CLI

```sh
concord concepts index --json
concord concepts show --path docs/feature/feedback/concepts.md --json
concord concepts set --path docs/feature/feedback/concepts.md \
  --body ./concepts.md --expected-digest 'sha256:...'
```

- `index` 返回全部 catalog、概念与诊断。每个概念为 `{ reference, path, scope, concept: { id, term, definition, deprecated } }`，没有弃用名时 `deprecated` 为空数组。
- `show` 的 `state` 为 `missing`、`valid`、`invalid`，返回 `source`、`digest` 与解析后的 `catalog`（`title`、`imports`、`deprecated`、`concepts`），以及当前目录的有效概念与诊断。
- `set` 的 `--body` 是完整 Markdown 文件或 `-`。工具按提交的字节保存，不重新序列化；先严格解析，再执行导入依赖守卫。新建时 `--expected-digest null`，其余使用 `show` 返回的 digest。
- 结构化 action `concepts.set` 的输入为 `{ path, source, expectedDigest }`。

### Web

术语列表来自 `concepts index`，可按 `term`、定义与目录筛选。选中术语后，编辑区打开该 catalog 的 Markdown 源码并定位到对应二级标题；编辑时实时显示解析诊断，保存调用 `concepts.set`。

新建局部 catalog 时，经安全目录输入写入随包空 catalog，`expectedDigest` 为 null。草稿、基线、请求世代与跨目录保护沿用[目录归属方案](../../../scoped-terminology/plans/directory-owned/README.md#6-web-状态绑定)。

### 随包空 catalog

```markdown
# Project concepts

Each second-level heading defines one concept: its text is the only accepted spelling, `{#id}` is its stable identity, and the first paragraph is its definition.
```

`concord init` 只在 `docs/concepts.md` 缺失时写入上述内容，并取代原来的解释页提纲与空 `docs/concepts.json`。已有 `docs/concepts.md` 保留全部字节，即使它不是合法 catalog；之后的检查会报告 `InvalidConceptCatalog`。init 不再创建 `concepts.json`。

## 发布与恢复

`set-concepts` 只写一个 catalog：after 非空且解析合法，依赖守卫与[目录归属方案第 4 条](../../../scoped-terminology/plans/directory-owned/README.md#4-catalog-写入与依赖守卫)相同，只是成员改为全部已发现的 `concepts.md`。

`migrate-concepts` 是唯一可以删除 catalog 文件的操作，见下节。init 的例外只允许 `docs/concepts.md` 从 null 写成随包空 catalog 的精确字节。其它操作写入 catalog 路径、写入任意 Markdown 或删除 catalog，都在写入前被拒绝。

旧 CLI 留下的、写入 `concepts.json` 的 `set-concepts` journal 由匹配的旧 CLI 恢复；新运行时返回 `ConceptMigrationRequired`，不改写 journal。

## 从 concepts.json 迁移

docs 下存在任何 `concepts.json` 时，`concepts index/show`、`docs check` 与 `concord check` 返回 `ConceptMigrationRequired`，`complete` 为 false，并列出全部 `concepts.json` 路径。运行时不解析 JSON catalog 的内容。

迁移由一次显式事务完成，因为路径从 `concepts.json` 变为 `concepts.md` 会同时改变全部 `imports` 引用：

```sh
concord concepts migrate --draft --language zh > /tmp/concepts-migration.json
# 作者逐项审阅并修改每个 body
concord --dry-run concepts migrate --input /tmp/concepts-migration.json
concord concepts migrate --input /tmp/concepts-migration.json
```

### 草稿

`--draft --language <lang>` 只读，不写文件。对每个 JSON catalog，用指定语言的 `preferred` 作为 `term`，复制定义，复制该语言的 `deprecated`，把 `imports` 中的 `concepts.json` 改为 `concepts.md`。

其它语言的名称和所有 `aliases` 不写入正文，逐条列在 `unplaced` 中供作者决定。某个概念缺少指定语言时，草稿中该概念的 `term` 为空，输入无法通过校验，直到作者填写。`--language` 必填，不推断。

### 迁移输入

```json
{
  "catalogs": [
    {
      "legacyPath": "docs/feature/feedback/concepts.json",
      "legacyDigest": "sha256:...",
      "path": "docs/feature/feedback/concepts.md",
      "expectedDigest": null,
      "body": "# 反馈术语\n\n## Issue {#issue}\n..."
    }
  ]
}
```

- `catalogs` 必须恰好覆盖全部已发现的 `concepts.json`，每项的 `legacyDigest` 等于当前字节摘要。
- `path` 必须是同目录的 `concepts.md`。`expectedDigest` 为该路径当前摘要；不存在时为 null。已有的解释页因此被显式替换，例如 init 旧版生成的 `docs/concepts.md`。
- 每个 `body` 必须是合法的 `concepts.md`。迁移后的完整 catalog 集合不得有 `InvalidConceptCatalog` 或 `DanglingConceptImport`。
- 收据列出每个 catalog 相对 JSON catalog 删除的概念 ID（`droppedConcepts`），供作者核对；删除本身不阻止迁移。

### 事务

操作名为 `migrate-concepts`。每个 catalog 产生两项变更：`concepts.md` 写入（before 为当前字节或 null），`concepts.json` 删除（after 为 null）。journal 记录全部 `concepts.json` 路径与摘要。

prepared 恢复校验每对变更与 `concepts.json` 成员不变后恢复精确前像；committed 恢复保留已提交内容。成员或任一前像变化时返回 `RecoveryConflict` 并保留现场。已迁移的仓库再次执行返回空的 `changedPaths`，不写文件。

迁移不从名称推断定义，不把 aliases 自动当作弃用名，不选择语言。

## 宪法修订

修订 [C-001](../../../../constitution.md#c-001)：

- 第 1 款：领域术语由 docs 下按目录归属的 `concepts.md` 拥有，写作政策由同目录的 `concord-writing.json` 拥有。
- 第 2 款：目录确定术语与政策的局部作用域，docs 根拥有全局定义。术语的定义与解释写在同一 `concepts.md`；其它 Markdown 链接到定义，不重复维护。

款 ID 不变，修订记录写明理由、来源与影响。

## 受影响的 Spec 与入口

| 位置 | 变化 |
| --- | --- |
| `docs/feature/documentation-quality/` | README、policy 与相关 Use Case 改为 `concepts.md` 格式、单一写法与迁移 |
| `docs/feature/local-sdlc/` | init 产物与 cli 示例改为 `docs/concepts.md` |
| `docs/feature/web-workbench/architecture.md` | 术语页改为源码编辑；`docs/concepts.md` 不再是通用支持页面 |
| `docs/architecture.md` | init 产物列表 |
| 随包模板、skill 与 `AGENTS.md` | 改写 JSON owner 的说明，随实现交付 |

本仓库的 4 个 `concepts.json` 与 `docs/feature/feedback/terminology.md` 由实现后的 `concepts migrate` 迁移；每个概念的 `term` 由作者选定。

## 取舍与风险

- 二级标题被保留给概念。需要分节的解释写在页面引言或概念下的三级标题中。
- Web 由字段表单改为源码编辑，换来原文字节不被工具改写；解析诊断弥补表单校验。
- 改名时 ID 不变，作者把旧写法加入 `deprecated`，检查会找出全部旧写法。
- 一些 `term` 是常用词，例如「连接」「索引」，正文中的普通用法也会计为使用。这只影响 `unusedConcept` 统计，不产生禁词。
