---
relations:
  - role: spec
    target: docs/feature/local-sdlc/use-case/recover-local-state.md
---

# 解除观察槽位的回执可能报告新占用者

## 现象

`src/app/recovery.ts` 在两段独立的写互斥中先解除、后读取槽位。另一观察在两段之间领取时，`recover --release-observation-slot` 的回执报告新占用者，而不是 `observationSlot.status: "released"`。见[状态页的差异表](../feature/local-sdlc/statechart.md#实现与模型的差异)。

## 期望

回执描述本次解除的结果。回归：在两段之间暂停，让另一观察领取后继续，回执仍是 `released`，新占用者照常持有槽位。
