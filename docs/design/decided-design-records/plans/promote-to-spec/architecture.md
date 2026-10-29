# promote-to-spec 架构

## Entity Ownership

| 内容 | Owner |
| --- | --- |
| 使用者可观察的行为、公开结构、错误码与验收 | Feature README、Use Case、cli、library 页（[C-012-1](../../../../constitution.md#c-012-1)） |
| 一个 Feature 的内部实现：实体归属、数据流、不变量、资源生命周期 | 该 Feature 的 architecture 或 lifecycle 页（[C-012-3](../../../../constitution.md#c-012-3)） |
| 跨 Feature 的系统边界 | `docs/architecture.md` |
| 本仓库的构建、测试与维护机制 | `docs/engineering/**` |
| 裁决时的 Problem、Goals、Limits、Cases、候选与理由 | Design 包，裁决后不随实现改写 |

## 检查规则

`concord check` 新增 relation 类 finding `SpecDependsOnDesignRecord`，结果与退出码遵守[聚合门禁](../../../../feature/documentation-quality/README.md#聚合门禁)。

- 来源页：Feature 包、项目 `architecture.md`、宪法、engineering 页与 docs 顶层页面中的 Markdown 与 MDX。`docs/design/**`、`docs/research/**`、`docs/roadmap/**`、`docs/issues/**`、`docs/_template/**` 与 Memory 来源不在其中。
- 允许的目标：`docs/design/<id>/README.md` 与 `docs/design/<id>/DECISION.md`，含锚点。
- 报告的目标：`docs/design/<id>/` 下的其它任何文件，包括 `plans/**`、`GOALS.md`、`LIMITS.md`、`CASES.md` 与包内支持页面。
- finding 字段沿用现有 relation finding：`path`、`line`、`message`（含链接目标）。不解析正文语义，只看解析后的链接目标；代码块与行内代码中的路径不计。
- 实现位置：与宪法条款链接校验相同的 Markdown 链接提取（`src/constitution.ts`、`src/project-check.ts`），不另建链接索引。行为 Spec 写入[聚合门禁](../../../../feature/documentation-quality/README.md#聚合门禁)；测试覆盖 Cases C3–C6。

## 迁移

### 每个包的步骤

1. 读选中候选的全部页面与 DECISION，列出其中的规范性陈述。
2. 对照当前实现核实每一条：仍成立的，改写进上表对应的 Spec 页；与实现不一致的，不自行选择，用 `concord issue create` 登记，Spec 中只写已核实成立的部分。
3. 改写遵守现行写法：现行句式，不描述历史，不复述比较过程；理由用一句话加依据链接 `[决策依据](../../design/<id>/DECISION.md)`。
4. 把 Spec 中指向候选页、CASES、GOALS、LIMITS 的链接改为指向写入后的 Spec 位置，或改为 README/DECISION 依据链接。Use Case 引用 CASES 作为验收的，把所需场景写成该 Use Case 自己的验收条目。
5. 不修改 Design 包的任何文件。
6. `concord docs check` 与 `concord check` 通过；`git grep` 确认本组 Spec 页不再依赖 Design 记录。

### 分组

按目标 Spec 分组，组间写入的文件不重叠；`docs/architecture.md` 的不同段落可以由不同组并行修改，各组只改与自己包对应的段落。

| 组 | Design 包 | 主要目标 Spec |
| --- | --- | --- |
| A | contract-writing、controlled-writing、markdown-terminology、scoped-terminology | `docs/feature/documentation-quality/**` |
| B | test-journey-steps、lsp-integration、test-adapters、derived-code-reference、path-safety-cost、annotation-case-identity、document-identity、typescript-native | `docs/feature/local-sdlc/**` |
| C | repository-workflows、neutral-project-governance、repository-process-adapter | `docs/feature/neutral-project-governance/**`、`docs/feature/feedback/**`、`docs/repository-profile.md` |
| D | workspace-projection、pr-change-preview | `docs/feature/web-workbench/**` |
| E | hawdb-data-engine、asynchronous-projections、diagnostic-projection-drift、portable-publication、operation-boundaries、plan-content、document-packages | `docs/feature/local-data-engine/**`、`docs/feature/portable-coordination/**`、`docs/feature/document-packages/**`、`docs/architecture.md` |
| F | constitution-structure、onboarding-contracts、ts-only-runtime | `docs/feature/project-onboarding/**` |

hawdb-data-engine 按当前实现与当前选中候选提升；[CLI 热路径设计](../../../cli-hot-path/README.md)裁决后再按其结论修改 Spec，迁移时不预先采用未裁决的内容。

### 指引

- `skills/concord/SKILL.md` 与 `skills/concord/references/document.md`：现行行为读 Feature、architecture 与 engineering 页；Design 只在重新审视某项决策时读取；裁决后提升规则。
- `docs/concord.md` 与 `docs/agent-workflow.md`：同上。
- AGENTS.md：本仓库开发同上。

## Invariants

1. Design 包文件在迁移前后逐字节相同。
2. 迁移后 `SpecDependsOnDesignRecord` 在本仓库为零。
3. 每个已裁决包仍至少被一个 Spec 页面以 README 或 DECISION 链接。
4. 迁移不移动任何文件，不改变任何 metadata。

## Errors

| 阶段 | 失败 | 处理 |
| --- | --- | --- |
| 核实 | 候选规定与实现不一致 | 登记 Issue，Spec 只写已核实部分 |
| 检查 | 迁移未完成时 finding 非零 | 交付门禁失败；检查规则与迁移在同一次交付中完成 |

## Identity and Reuse

不新增身份。finding 的定位沿用现有 relation finding 的路径与行号。

## 验证

- C1：迁移后随机抽取 10 条原先以「见采用设计」引用的规则，在 Spec 中逐条找到。
- C2：修改一条已提升规则，只改 Spec 页即通过 `concord check`。
- C3–C6：检查规则的打包 CLI 测试。
- C7：迁移交接列出全部登记的 Issue。
- G2：迁移后复测 Spec 范围与 `docs/` 总量的字节数。
