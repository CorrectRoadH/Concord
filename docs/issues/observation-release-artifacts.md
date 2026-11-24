---
relations:
  - role: spec
    target: docs/feature/local-sdlc/use-case/recover-local-state.md
---

# 人工解除观察槽位不回收收集产物目录

## 现象

`concord recover --release-observation-slot <token>` 只删除占用、运行状态与隔离标记。收集创建的 `adapter-reports-*` 目录由进程内 finalizer 持有，路径不在运行状态里，占用者被强杀后解除也不回收它（`src/base/publication/run-coordination.ts`、`src/base/publication/scratch.ts`）。见[状态页的差异表](../feature/local-sdlc/statechart.md#实现与模型的差异)。

## 期望

解除回收该槽位登记的收集产物目录，符合[恢复本地状态](../feature/local-sdlc/use-case/recover-local-state.md)。回归：强杀报告了产物路径的受管收集，确认进程组消失后解除，产物目录被删除。
