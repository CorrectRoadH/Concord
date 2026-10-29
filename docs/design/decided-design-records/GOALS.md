# 已裁决的 Design 只保留决策记录

## G1: 现行规则只有一个 owner

每条现行行为或实现规则都完整写在 Feature、项目 architecture、宪法或 engineering 页中；Spec 正文不把现行规则交给 Design 拥有。判据：迁移核对表覆盖全部迁移输入，每个条目有唯一目标 owner 或明确的「已被取代」依据（C1）；含「拥有、规定、遵守、见采用设计」等委托语句的位置逐条复核。

## G2: 读到现行规则所需的文档量显著减少

在基准提交 `f597d199db3b1d2a3d5e3c2085ce763ffdc850c2` 冻结阅读计量集合。集合包括 `docs/feature/`、`docs/engineering/` 下及 `docs/` 顶层的 Markdown 与 MDX，以及 27 个已裁决包中选中候选的 Markdown 与 MDX。包根直接子级中除 README、GOALS、LIMITS、CASES、DECISION 外的 Markdown 支持页也计入。按文件原始 UTF-8 字节计，每个 canonical 路径只计一次。该集合是固定的计量语料，不代表精确的链接闭包；未计入的验收与裁决页仍按迁移输入规则核对。

基准 Spec 为 409,601 B，选中候选与共同支持页为 315,631 B，B0 = 725,232 B。迁移后 B1 为同一 Spec 目录范围内全部 Markdown 与 MDX 的字节数，要求 B1 ≤ 543,924 B，即相对基准 Spec 的净增量不超过 134,323 B。不得通过删除已采用要求、移出计量范围或降低规则覆盖达标。B0 固定，达不到预算时先显式修订本目标。

## G3: 规则由检查器强制

Spec 页面链接到候选页、CASES、GOALS、LIMITS 或包内支持页时，`concord check` 报告具名 finding，交付门禁失败。该检查只证明链接目标的边界，不证明正文不存在委托、遗漏或重复，后者由 G1 的迁移核对验收。判据：C3、C5、C8。

## G4: 决策仍可追溯

读者能从 Spec 页面找到相关决策的理由。判据：迁移后每个已裁决包仍被至少一个 Spec 页面以 README 或 DECISION 链接为依据（C4）。
