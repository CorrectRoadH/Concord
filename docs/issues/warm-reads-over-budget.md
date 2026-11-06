---
relations:
  - role: spec
    target: docs/feature/local-data-engine/performance.md
---

# warm 读取与工作台文件接口超出绝对预算

## 现象

格式断点 `0113297` 的绝对预算验收（`--reference`，38 个场景、每个 7 个有效样本）中 5 个场景超出预算（`/tmp/concord-closure/lead5-relation-bench-reference.json`）：

| 场景 | p50 ms | 预算 ms |
| --- | ---: | ---: |
| local-data-engine/trace-gaps-warm | 1281 | 600 |
| local-data-engine/trace-show-warm | 1373 | 600 |
| local-data-engine/review-warm | 1329 | 600 |
| web-workbench/file | 830 | 280 |
| web-workbench/document-set | 931 | 550 |

空闲机器上源码 CLI 仅 `--version` 就约 600 ms，经已运行的服务做一次 `check` 约 850 ms，warm 读取的大部分时间可能在 CLI 启动与服务往返，而不在查询本身。

## 期望

各场景的 p50 不超过所属 Feature `performance.md` 的预算（[性能测量](../engineering/performance/README.md)）。先用 profile 分出 CLI 启动、服务往返与查询各自的耗时，再决定改哪一段；不提高预算、不减少样本。
