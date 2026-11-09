---
relations:
  - role: spec
    target: docs/feature/local-sdlc/performance.md
---

# concord schema 超出性能预算

## 现象

固定 529b217 的独立 clone 中七样本对照：`local-sdlc/schema` 候选 p50 721.505ms、基线 720.877ms，相对比较通过，但都超过 430ms 的预算（`/tmp/concord-closure/cli-followup-report.md`）。同为不需要项目目录的 `template list` 预算是 430ms。

## 期望

定位 CLI 启动、模块加载与 JSON Schema 生成各自的成本。使用 Bun 的 CPU profiler 运行真实 `schema` 命令，采样边界与上面的整进程观测保持一致；进程内 Mitata 场景不证明这一启动成本。建立同边界的参照与验收阈值后再评价优化，不将不同工具和边界的数值直接比较。
