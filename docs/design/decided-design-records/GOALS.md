# 已裁决的 Design 只保留决策记录

## G1: 现行规则只有一个 owner

每条现行行为或实现规则都写在 Feature、项目 architecture、宪法或 engineering 页中；不存在只写在已裁决候选页里的现行规则。判据：迁移后 Spec 页面没有依赖候选页、CASES、GOALS 或 LIMITS 的链接（C3），且抽查的规则在 Spec 中可找到（C1）。

## G2: 读到现行规则所需的文档量减半

agent 了解现行行为所需读取的范围限于 Feature、项目 architecture、宪法与 engineering 页。判据：该范围的总字节数不超过 `docs/` 总量的一半（2026-10-29 约 0.41 MB / 1.08 MB）。

## G3: 规则由检查器强制

Spec 页面依赖候选页、CASES、GOALS 或 LIMITS 时，`concord check` 报告具名 finding，交付门禁失败。判据：C3、C5。

## G4: 决策仍可追溯

读者能从 Spec 页面找到相关决策的理由。判据：迁移后每个已裁决包仍被至少一个 Spec 页面以 README 或 DECISION 链接为依据（C4）。
