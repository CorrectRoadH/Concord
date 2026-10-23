# 链接拥有依据关系

## Problem

依据关系应写在依据它的那句话旁，并且每个链接都被校验。

## Core Mental Model

条款与款使用全仓库统一的 `{#id}` 语法。正文中指向宪法 ID 的 Markdown 链接是依据关系的唯一来源，`constitutionRefs` 取消。`check` 校验所有这类链接，`constitution show` 从链接派生反向视图。

### 条款与款的 ID

- 条款是 H2 标题，形如 `## C-011 关联由源码声明拥有，指向最小完整范围 {#c-011}`。ID 为 `c-` 加三位数字，标题以对应的大写标签开头。
- 款是条款下的根有序列表项，第一段末尾写 ` {#c-011-test-source}`。ID 以所属条款 ID 加连字符开头，其余部分为小写字母、数字与单连字符。
- 生效的宪法中，条款与每一款都必须有 ID，全文唯一，与标题 slug 共用命名空间。
- 总则使用 `## 总则 {#general}`，其中各款可以带 `{#general-<name>}`，不强制。
- 代码块、行内代码、HTML 注释与缩进代码中的 `{#...}` 不产生 ID。
- 列表项 `{#id}` 目前只在 Use Case 的根有序列表中有效，其它页面返回 `InvalidStepPosition`。本方案把同一语法扩展到宪法，规则与 Use Case 步骤相同。

不符合以上规则时返回 `ConstitutionClauseInvalid`，指出行号与原因。

### 依据关系

- 来源：`docs/` 下除 `docs/_template/` 外所有 Markdown 页面中的行内链接，目标解析到 `docs/constitution.md` 并带 anchor。引用式链接、HTML 与代码中的链接不计入。
- 不带 anchor 的链接不建立关系，也不产生 finding。
- anchor 不是条款或款的 ID 时，`check` 返回 `AnchorNotFound`，类别为 `relation`，带路径与行号，退出 1。
- 指向款的链接同时归属其条款。Feature 不要求链接任何条款。

### 反向视图

`concord --json constitution show` 的结果：

```json
{
  "operation": "constitution-show",
  "constitution": {"path": "docs/constitution.md", "digest": "sha256:...", "clauses": [{"id": "c-011", "title": "关联由源码声明拥有，指向最小完整范围", "paragraphs": ["c-011-test-source", "c-011-code-source"]}]},
  "references": [{"path": "docs/design/lsp-integration/LIMITS.md", "line": 21, "clause": "c-007", "paragraph": "c-007-credentials"}]
}
```

`references` 取代 `affected`，`clauses` 取代 `anchors`。`trace` 的 `constitution` 边从页面指向 `docs/constitution.md#<id>`。`review render` 按条款列出引用位置。

### 修订保护

`constitution amend` 与 `adopt` 删除或改名一个仍被链接的 ID 时，返回 `ConstitutionClauseReferenced`，列出引用位置，不写入。作者先新增 ID、改链接，再删除旧 ID。

### 取消的接口

- Feature 与 Design 元数据的 `constitutionRefs`。
- `feature create` 与 `design create` 的 `--constitution-ref`。
- `document.metadata` action 的 `constitutionRefs` 字段与 Web 中的对应输入。
- 模板、init 指引与随包 skill 中要求记录 `constitutionRefs` 的文字，改为“在依据规则的句子旁链接条款”。

元数据仍有 `constitutionRefs` 时，返回 `ConstitutionMigrationRequired`，指出路径与字段，不按普通解码错误处理。

### 迁移

`concord constitution migrate` 在一个可恢复的变更集中完成全仓库迁移，支持 `--dry-run`：

1. 宪法格式从 `concord.constitution/v1` 改为 `v2`。每个 `<a id="c-NNN"></a>` 行并入下一行 H2 标题的 `{#c-NNN}`；条款下第 K 个根有序列表项补 `{#c-NNN-K}`。修订记录原样保留。
2. 每个带 `constitutionRefs` 的 Feature 与 Design 删除该字段，在正文末尾的 `## Constitution` 节中为每条引用写一行链接；节已存在时追加。
3. 未完成的写入、无法严格解码的 owner 或路径冲突使迁移整体拒绝，不留下部分写入。

```json
{"operation":"constitution-migrate","dryRun":false,"changedPaths":["docs/constitution.md","docs/feature/local-sdlc/README.md"],"clauses":15,"paragraphs":66,"movedReferences":248}
```

迁移生成的数字 ID 保持其迁移时的序号含义，正文中“C-011 第 3 款”对应 `#c-011-3`。之后 ID 冻结，作者可以经 amend 改为有语义的名称，并同步改链接。

### 条款写法

总则新增“条款写法”，各款为：

```markdown
1. 每条款陈述一项规则，标题就是规则本身。 {#general-one-rule}
2. 每款一项可审阅的义务，用“必须”“不得”“可以”标明强度，并带稳定 ID。ID 一经采用不改名、不复用。 {#general-paragraph-id}
3. 条款只写规则。机制、引擎、库、协议细节与数据结构写在 architecture 页，理由、来源与影响写在修订记录，过程写在 Memory。 {#general-rules-only}
4. 用现行句式，不描述与过去的差别。 {#general-present}
5. 依据某条规则的句子旁写指向其 ID 的链接，不用“第 N 款”这类序号文字。 {#general-link}
```

同一规则写进 `docs/_template/constitution.md` 与 `concord --skill document`。

## Scope

- 实现以上语法、关系、校验、输出、保护与迁移；删除取消的接口。
- 自举：对本仓库执行迁移，再按条款写法改写宪法。C-001.4、C-005.3 至 .4 与 C-013 中的引擎、桥接与协议细节移到 `docs/architecture.md`；36 处“第 N 款”文字改为链接；数字款 ID 改为语义名称。
- 不改变测试标记、代码声明、Memory 与 Issue 的格式。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-运行时只接受当前格式) | satisfied | 旧宪法与旧元数据返回 `ConstitutionMigrationRequired`，由 `constitution migrate` 显式转换；运行时不读取旧格式 | 本页“迁移”与“取消的接口” |
| [L2](../../LIMITS.md#l2-条款身份与修订历史保持) | satisfied | `<a id>` 的值原样成为标题 ID，修订记录不改动 | 本页“迁移”第 1 项 |
| [L3](../../LIMITS.md#l3-迁移遵守写入契约) | satisfied | 全部改动在一个变更集中校验前像并发布，可 dry-run 与恢复 | 本页“迁移”第 3 项 |
| [L4](../../LIMITS.md#l4-破坏性变更经独立审查) | pending | 取消三处接口并改变 `constitution show` 输出；定案前由独立 reviewer 审查 | 审查尚未完成 |
| [L5](../../LIMITS.md#l5-不改变测试与代码关联) | satisfied | 只改变宪法与 Feature、Design 元数据 | 本页 Scope 第 3 项 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-引用精确到款且稳定) | satisfied | 款 ID 与序号无关，采用后冻结 | C1 |
| [G2](../../GOALS.md#g2-断开的引用被-check-发现) | satisfied | 所有指向宪法的行内链接都校验；amend 拒绝删除仍被引用的 ID | C2、C7 |
| [G3](../../GOALS.md#g3-依据关系只有一个-owner) | satisfied | 链接是唯一来源，元数据字段取消，反向视图派生 | C3、C6 |
| [G4](../../GOALS.md#g4-宪法只写规则) | partial | 条款写法可逐条审阅，但没有机械检查实现词：写作政策按目录生效，宪法位于 docs 根，禁用实现词会作用于全部文档 | C8 由审阅判定 |
| [G5](../../GOALS.md#g5-用-concord-自己完成迁移与验收) | satisfied | 迁移与修复都用 Concord 命令完成，Problem 以 red 与 green 收据关闭 | Design README“自举” |
