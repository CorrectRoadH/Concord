---
relations:
  - role: spec
    target: docs/feature/local-data-engine/architecture.md
---

# 当前来源查询每次重读全部文件

## 现象

NiceEval（`e2e/` 下 1950 个文件）在服务已热时运行 `concord --json test list` 仍需 3.4–3.6 秒，`concord --version` 约 0.45 秒，`concord --json list feature` 约 0.64 秒（负载 25–35）。查询每次读取并核对全部来源字节，服务的热解析缓存只省去解析。

## 期望

先在 NiceEval 上 profile 服务已热、没有文件变化时的 `test list`，分出 CLI 启动、服务往返、读取与核对来源、标记扫描、输出各自的耗时（[快到每次都愿意跑](../taste.md#t-7)）。按占比最大的一段提出改法；如果要放宽“当前源字节每次读取”，必须同时说明它与[缓存与原生边界的约束](../feature/local-data-engine/architecture.md#缓存与原生边界的约束)第 5 条的关系，先交 t84 定 Spec。
