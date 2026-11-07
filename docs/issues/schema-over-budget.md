---
relations:
  - role: spec
    target: docs/feature/local-sdlc/performance.md
---

# concord schema 超出性能预算

## 现象

固定 529b217 的独立 clone 中七样本对照：`local-sdlc/schema` 候选 p50 721.505ms、基线 720.877ms，相对比较通过，但都超过 430ms 的预算（`/tmp/concord-closure/cli-followup-report.md`）。同为不需要项目目录的 `template list` 预算是 430ms。

## 期望

p50 不超过 [性能预算](../feature/local-sdlc/performance.md)。先用 `bench:profile local-sdlc/schema` 分出 CLI 启动、模块加载与 JSON Schema 生成各自的耗时，再改占比最大的一段；不提高预算。
