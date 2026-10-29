# 已裁决的 Design 只保留决策记录

| Case ID | User Problem | Fixed Input | Acceptance Result |
|---|---|---|---|
| C1 | agent 需要某项现行规则 | 随机抽取 10 条当前被 Spec 以「见采用设计」引用的规则 | 每条都能在对应 Feature、architecture 或 engineering 页中找到，无需打开 Design 包 |
| C2 | 规则后来改变 | 修改一条已提升的规则 | 只改 Spec 页即可通过 `concord check`；Design 包不需要改动 |
| C3 | Spec 依赖候选页 | Feature 页新增指向 `docs/design/<id>/plans/...` 的链接 | `concord check` 报告具名 finding 并失败 |
| C4 | 查找决策理由 | Feature 页链接某 Design 的 README 或 DECISION | `concord check` 不报告；读者可从该链接看到裁决 |
| C5 | 新裁决的 Design | 运行 `concord design decide` 后，Spec 仍引用选中候选页 | `concord check` 报告 finding，直到规则提升到 Spec |
| C6 | Research、Roadmap、Memory 或 Issue 引用候选页 | 这些页面链接任意 Design 页面 | 不报告 |
| C7 | 候选正文与代码不一致 | 迁移时发现候选规定与实现不同 | 不自行选择其一；登记 Issue，Spec 中写明待决处 |
