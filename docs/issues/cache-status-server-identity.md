---
relations:
  - role: adopts
    target: docs/feature/local-data-engine/use-case/use-unified-cache.md
---

# 服务运行时 cache status 缺少服务 pid 与安装身份

## 现象

工作区服务运行时，`concord cache status` 的人读输出与 `--json` 都只有 `sourceDigest`，没有服务的 pid 与安装身份。由 docs-refactor-data 实测（`/tmp/concord-closure/docs-refactor-data-delivery.md` 待决 3）。

## 期望

服务运行时结果报告服务的 pid、安装身份与当前结果的 `sourceDigest`；没有服务时报告由当前进程持有（[替换持久缓存](../feature/local-data-engine/use-case/use-unified-cache.md#status)）。
