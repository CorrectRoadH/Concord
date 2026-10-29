# 已裁决的 Design 只保留决策记录

## Decision

Selected: [promote-to-spec](plans/promote-to-spec/README.md)

## Rationale

promote-to-spec 满足全部 Limit：迁移只改 Spec 与链接，不移动文件、不改 Design 记录；宪法修订按 C-008 记录；新增的 finding 不改变既有输出。它直接实现 G1：每个迁移输入条目在核对表中有唯一 owner 或取代依据，已采用但未实现的要求仍作为预期行为写入 Spec。G3 由 `SpecDependsOnDesignRecord` 强制链接目标的边界，正文委托由迁移核对逐条处理。

G1: 待迁移完成后按核对表验收，当前为 pending。

G2: 固定基线 B0 = 725,232 B，预算 B1 ≤ 543,924 B，相对基准 Spec 的净增量不超过 134,323 B。选中候选原文约 302 KB，因此迁移必须去重、剔除已被取代的内容并精炼改写；达不到预算时先显式修订本目标，不以删减要求达标。

G3: 检查器只证明链接目标边界，不证明正文无委托或遗漏，这一缺口由 G1 的核对覆盖。

G4: 迁移保留依据链接，待迁移后验收。

## Rejected Options

designs-as-spec 可以让选中候选成为唯一 owner，但读者仍要进入候选页，且无法区分已被后续裁决取代的内容；维持同步还需要先修订记录保存政策。它不满足 G1、G2 与 G3。

派生的现行规则视图不在本次比较之列，可作为迁移之后的检索能力另行考虑。

## Residual Risks

- 迁移中可能出现无法由采用依据消解的冲突，需要主 agent 逐项裁决。
- G2 的预算较紧，部分 Feature 的提升可能需要先合并重复的现行规则。
- 检查器之外，新的委托语句仍可能在今后写入 Spec；依靠 agent 指引与评审发现。
