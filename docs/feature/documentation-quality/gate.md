# 聚合门禁

`concord check` 是项目交付门禁，同时执行关系与生命周期检查和写作检查（[接入项目采用的范式](../project-onboarding/README.md#接入项目采用的范式)）。写作部分使用与 `concord docs check` 默认模式相同的文件选择与规则合成，不接受 `--rules`；独立 profile 与 `docs check --rules` 的结果不能替代门禁。

- 必查范围：按[默认文件选择规则](policy.md#写作政策)派生，即全部政策的有效 roots，加上没有同目录政策的概念目录；门禁不接受缩小该集合的参数。
- 必需规则：禁词、字符句长与段长、受控 token 句长与段落句数、显式启用的词法规则及术语使用检查都参与门禁。项目可以调整阈值与词表，用 `exempt`、`allowIn` 与局部政策豁免具体位置；数字阈值为 null 或布尔选项为 false 表示项目采用的参数，门禁仍执行其余规则。
- 无政策：仓库没有任何写作政策与概念来源时，门禁报告 `WritingPolicyNotFound` 并失败。`concord init` 为新项目写入随包预设；已接入项目直接创建 `docs/concord-writing.json`，或用 `concord writing set --path docs/concord-writing.json --expected-digest null` 保存政策后通过。
- 结果：JSON 的 `ok` 在全部检查无 finding 且输入完整时为 true。`complete` 为 false 表示关系图或写作输入不完整，包括政策缺失、无效和读取失败。每条 finding 带 `category`（`relation` 或 `writing`）与具名 code。`checks.relations` 与 `checks.writing` 分别给出 `ok` 与 `complete`。
- 退出码：`ok` 为 true 时退出 0，否则退出 1。输入不完整与违规通过 `complete` 和 finding code 区分。
- 入口一致：CLI `check`、结构化 action 与 Web 的项目检查使用同一聚合结果。
- Design 记录边界：Spec 页面链接到 Design 包内除 README 与 DECISION 以外的页面时，报告 relation 类 finding `SpecDependsOnDesignRecord`，带来源路径、原始行号与链接目标（[Design 记录](../../document-model.md#design-记录)）。

Spec 页面指 Feature 包、项目 `architecture.md`、宪法、engineering 页与 docs 顶层页面。`docs/design/`、`docs/research/`、`docs/roadmap/`、`docs/issues/`、`docs/_template/` 与 `memory/` 不受此限。

该检查覆盖行内与引用式链接，目标解码并规范化后比较，锚点不改变结果；图片、代码、HTML 注释、frontmatter 与 MDX 非正文源码不计。来源无法读取或解析时 `complete` 为 false。它只约束链接目标，不判断正文是否仍把规则委托给 Design。

聚合门禁失败不阻断局部读取、`docs check`、`writing` 与 `concepts` 工具、直接编辑，以及修复所需的其它命令。
