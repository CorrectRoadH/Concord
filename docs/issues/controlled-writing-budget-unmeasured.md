---
format: concord.document/v1
id: controlled-writing-budget-unmeasured
title: 受控写作性能预算没有接入测量
createdAt: 2026-10-29T16:17:49.312Z
kind: issue
state: closed
memoryRelations: []
adoptions:
  current: []
  history: []
closure:
  kind: closed
  reason: budgets.ts 已改为扫描 docs/feature/ 的预算表，documentation-quality 的五个场景由 bench/documentation-quality.bench.ts 拥有，policy.md 的「性能预算」改为场景格式并接入测量；pnpm check 的覆盖测试保证预算行与场景一一对应。
history:
  - at: 2026-10-29T16:21:19.987Z
    action: close
    reason: budgets.ts 已改为扫描 docs/feature/ 的预算表，documentation-quality 的五个场景由 bench/documentation-quality.bench.ts 拥有，policy.md 的「性能预算」改为场景格式并接入测量；pnpm check 的覆盖测试保证预算行与场景一一对应。
---

# 受控写作性能预算没有接入测量

[受控写作性能预算](../feature/documentation-quality/policy.md#受控写作性能预算)声明了 `concord docs check` self 与 scale 场景及 `concord check` 的 warm p50 预算。`scripts/perf/budgets.ts` 的 `budgetSources` 只读取 local-sdlc 与 local-data-engine 的预算表，不读取该表；仓库中也没有 [性能验收](../engineering/concord-self-hosting/performance.md#预算表格式) 所述的 `bench/<feature-id>.bench.ts` 场景。scale 消费者与 v2/v3 交错对照同样没有测量路径。

待调查：该表按哪种预算表格式接入测量，`concord docs check` 与 `concord check` 的 self 行是否与 local-sdlc 的同名行合并为一个 owner。
