# 已裁决的 Design 只保留决策记录

## Decision

Undecided.

## Rationale

待独立审查后裁决。当前比较：designs-as-spec 不满足 [L1](LIMITS.md#l1-一个事实一个-owner) 与 [L2](LIMITS.md#l2-不改写历史记录)，现行规则在 Spec 与候选页之间拆分，而维持同步又要求改写裁决时的记录。promote-to-spec 满足全部 Limit，剩余待验证项是迁移的完整性与检查规则的覆盖。

## Rejected Options

待裁决。

## Residual Risks

- 迁移中发现的候选与实现不一致之处需要逐项裁决，可能多于预期。
- 迁移会增加 Spec 页的字节数，G2 需在迁移后复测。
