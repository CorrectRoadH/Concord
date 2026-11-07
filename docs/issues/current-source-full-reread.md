---
relations:
  - role: spec
    target: docs/feature/local-data-engine/architecture.md
---

# 当前来源查询每次重读全部文件

## 现象

NiceEval（`e2e/` 下 1950 个文件）在服务已热时运行 `concord --json test list` 仍需 3.4–3.6 秒，`concord --version` 约 0.45 秒，`concord --json list feature` 约 0.64 秒（负载 25–35）。查询每次读取并核对全部来源字节，服务的热解析缓存只省去解析。

## 期望

按[解析缓存](../feature/local-data-engine/architecture.md#解析缓存)：每个文件按元数据指纹判断是否变化，指纹不变就复用缓存的摘要与解析结果，只读取变化的文件。在 NiceEval 上，服务已热、没有文件变化时，`test list` 的耗时接近 CLI 启动加一次服务往返；交付时给出前后实测。以 `--reason` 关闭，写明提交与实测数字。
