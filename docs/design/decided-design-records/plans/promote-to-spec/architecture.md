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

`concord check` 新增 relation 类 finding `SpecDependsOnDesignRecord`，结果与退出码遵守[聚合门禁](../../../../feature/documentation-quality/README.md#聚合门禁)，CLI 页面声明新的 finding 代码（[C-015](../../../../constitution.md#c-015-1)）。

- 来源页：Feature 包、项目 `architecture.md`、宪法、engineering 页与 docs 顶层页面中的 Markdown 与 MDX。`docs/design/**`、`docs/research/**`、`docs/roadmap/**`、`docs/issues/**`、`docs/_template/**` 与 Memory 来源不在其中。
- 允许的目标：`docs/design/<id>/README.md` 与 `docs/design/<id>/DECISION.md`，含锚点。
- 报告的目标：`docs/design/<id>/` 下的其它任何文件，包括 `plans/**`、`GOALS.md`、`LIMITS.md`、`CASES.md` 与包内支持页面。
- 链接范围：作者写下的行内链接与可解析的引用式链接。排除图片、代码块与行内代码、HTML 注释、frontmatter 以及 MDX 的非正文源码，保留原始行号。目标先解码、规范化为仓库路径，再与上述范围比较；越出仓库的路径按现有路径安全规则处理。
- 完整性：必需来源无法读取或解析时报告 `complete: false` 并非零退出，不把遗漏当作零 finding。
- 实现：共享现有的 Markdown AST 与路径规范化能力（`src/markdown-parser.ts`、`src/constitution.ts` 的链接提取、`src/project-check.ts`），为本规则单独定义上述链接范围，不改变宪法与概念链接规则的语义，不另建链接索引。
- 证明范围：该 finding 只保证 Spec 不链接到 Design 记录中的规则页。正文是否仍把规则委托给 Design、是否遗漏规则，由迁移核对验收，检查器不做语义判断。

## 迁移

### 输入与核对表

每个已裁决包的迁移输入是：README、DECISION、选中候选的全部页面，以及包根的共同支持页，连同它们引用的规则、约束与验收。共同支持页例如 `docs/design/test-journey-steps/共同身份.md` 与 `docs/design/plan-content/architecture.md`。同时读取影响同一事实的后续裁决与当前 Spec。

迁移前为每个包建立临时核对表：每个规范性条目一行，记录来源位置、当前权威要求、唯一目标 owner 与处置。核对表是审查材料，随迁移交接提交给主 agent，不进入 `docs/`，不成为长期登记表。

### 每个条目的处置

| 情况 | 处置 |
| --- | --- |
| 已采用、未被取代，且实现满足 | 写入目标 owner |
| 已采用、未被取代，实现尚未满足 | 仍写入目标 owner 作为预期行为；实现差距用 `concord issue create` 登记 |
| 已被后续裁决或宪法修订取代 | 不提升，核对表记录取代依据；不登记为缺陷 |
| 没有采用依据可以消解的冲突 | 登记 Issue，由主 agent 裁决后再写入；不按实现自动删除、弱化或选定 |

写入遵守现行写法：现行句式，不描述历史，不复述比较过程；理由用一句话加依据链接 `[决策依据](../../design/<id>/DECISION.md)`。同一规则只在一个 owner 中完整声明，其它页面链接引用。Use Case 引用 CASES 作为验收的，把所需场景写成该 Use Case 自己的验收条目。

Spec 中指向 Design 记录的链接与「由某设计拥有、遵守采用设计、见采用设计」等委托语句，逐条改为指向写入后的 Spec 位置，或改为依据链接。只改链接而不写入规则不算完成。本次迁移不修改任何 Design 文件。

### 分工

先由迁移者为全部 27 个已裁决包建立核对表，得到「目标文件的段落或锚点 → 唯一修改责任」映射；不同段落可以并行，语义有先后依赖的先收敛再执行。

| 组 | Design 包 | 负责的目标 |
| --- | --- | --- |
| A | contract-writing、controlled-writing、markdown-terminology、scoped-terminology | `docs/feature/documentation-quality/**`；先合并术语与写作的后续裁决 |
| B | test-journey-steps、lsp-integration、test-adapters、derived-code-reference、path-safety-cost、annotation-case-identity、document-identity、typescript-native | `docs/feature/local-sdlc/use-case/**` 与 local-sdlc 的 architecture；先确定共同身份与路径安全规则的 owner |
| C | repository-workflows、neutral-project-governance、repository-process-adapter | `docs/feature/neutral-project-governance/**`、`docs/feature/feedback/**`、`docs/repository-profile.md` |
| D | workspace-projection、pr-change-preview | `docs/feature/web-workbench/**` |
| E | hawdb-data-engine、asynchronous-projections、diagnostic-projection-drift、portable-publication、operation-boundaries、plan-content、document-packages | `docs/feature/local-data-engine/**`、`docs/feature/portable-coordination/**`、`docs/feature/document-packages/**`、`docs/feature/cross-platform-release/architecture.md`；引用 B 确定的路径安全 owner |
| F | constitution-structure、onboarding-contracts、ts-only-runtime | `docs/feature/project-onboarding/**` |
| 主 agent | — | 项目 `architecture.md`、local-sdlc 的 README 与 cli 页、聚合门禁、宪法修订、skill、init 模板与提示、AGENTS.md；最终统一核对关系、委托语句与 G2 字节数 |

各组对主 agent 负责的文件只提交修改建议，由主 agent 集成。hawdb-data-engine 按当前已采用规则提升；[CLI 热路径设计](../../../cli-hot-path/README.md)裁决后再按其结论修改 Spec。

### 指引

- `skills/concord/SKILL.md` 与 `skills/concord/references/document.md`：现行行为读 Feature、architecture 与 engineering 页；Design 只在重新审视某项决策时读取；裁决后提升规则。
- `docs/concord.md` 与 `docs/agent-workflow.md`：同上。
- AGENTS.md：本仓库开发同上。

## Invariants

1. 本次迁移不修改任何 Design 文件；此后 Design 不为追随实现而改写，经授权的理由更正与内容组织调整沿用现有规则。
2. 迁移后 `SpecDependsOnDesignRecord` 在本仓库为零。
3. 每个已裁决包仍至少被一个 Spec 页面以 README 或 DECISION 链接。
4. 迁移不移动任何文件，不改变任何 metadata。

## Errors

| 阶段 | 失败 | 处理 |
| --- | --- | --- |
| 核实 | 已采用要求与实现不一致 | 要求写入 Spec，差距登记 Issue |
| 核实 | 无法消解的冲突 | 登记 Issue，主 agent 裁决后写入 |
| 检查 | 迁移未完成时 finding 非零 | 交付门禁失败；检查规则与迁移在同一次交付中完成 |

## Identity and Reuse

不新增身份。finding 的定位沿用现有 relation finding 的路径与行号。

## 验证

- C1：核对表覆盖全部迁移输入；另随机回读 10 条，在 Spec 中逐条找到。
- C2：修改一条已提升规则，只改 Spec 页即通过 `concord check`。
- C3–C6、C8：检查规则的打包 CLI 测试，包含引用式链接、MDX、编码路径、锚点、读取失败与多入口一致性。
- C7：迁移交接列出全部登记的 Issue。
- G2：迁移前在基准提交计算 B0，迁移后计算 B1。
