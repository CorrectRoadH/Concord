---
relations:
  - role: spec
    target: docs/engineering/performance/README.md
---

# 性能对照中 8 个场景连续两组样本无效

## 现象

2026-11-07 全 Feature 性能对照（`--changed 0113297 --compare 0113297`）中，40 个对照场景有 8 个因连续两组样本无效而无法判定（`/tmp/concord-closure/lead6-final-repair-bench-failure-triage.md`）：

- 只有基线的样本无效：local-sdlc 的 memory-list、memory-search、issue-list、trace-check、test-list。
- 只有候选的样本无效：local-data-engine 的 trace-gaps-warm、local-sdlc 的 code-list、web-workbench 的 document-set。

两组都有效的场景中没有超过 20% 的相对回退。

## 期望

每个场景都得到有效样本并给出判定（[性能测量](../engineering/performance/README.md)）。先查候选无效的三个场景：样本为什么无效（例如 warm 读取遇到 QueryPending、服务状态未就绪），属于产品行为时修产品，属于测量准备时修测量；基线无效的场景在下一个格式断点后的基线上重测。不删样本、不放宽统计阈值。
