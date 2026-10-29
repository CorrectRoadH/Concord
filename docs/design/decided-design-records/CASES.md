# 已裁决的 Design 只保留决策记录

| Case ID | User Problem | Fixed Input | Acceptance Result |
|---|---|---|---|
| C1 | agent 需要某项现行规则 | 迁移核对表列出的全部输入条目；另随机回读 10 条 | 每个条目有唯一目标 owner 或「已被取代」依据；回读的规则能在 Spec 中找到，无需打开 Design 包 |
| C2 | 规则后来改变 | 修改一条已提升的规则 | 只改 Spec 页即可通过 `concord check`；Design 包不需要改动 |
| C3 | Spec 依赖候选页 | Feature 页新增指向 `docs/design/<id>/plans/...` 的链接 | `concord check` 报告具名 finding 并失败 |
| C4 | 查找决策理由 | Feature 页链接某 Design 的 README 或 DECISION | `concord check` 不报告；读者可从该链接看到裁决 |
| C5 | 新裁决的 Design | 运行 `concord design decide` 后，Spec 仍引用选中候选页 | `concord check` 报告 finding，直到规则提升到 Spec |
| C6 | Research、Roadmap、Memory 或 Issue 引用候选页 | 这些页面链接任意 Design 页面 | 不报告 |
| C7 | 候选正文与代码不一致 | 迁移时发现已采用、未被取代的要求与实现不同 | 要求仍写入 Spec 作为预期行为；实现差距登记 Issue；不按实现删除或弱化要求 |
| C8 | 引用式链接、MDX 与编码路径 | Spec 用引用式链接、MDX 正文或百分号编码路径指向候选页；MDX 源码中出现同样字符串 | 前三者报告 finding；MDX 非正文源码与代码块不报告；来源读取失败时 `complete: false` 并非零退出 |
| C9 | 已被后续裁决取代的规则 | 候选规定已被后来的 Design 或宪法修订替代 | 不提升，也不登记为缺陷；核对表记录取代依据 |
