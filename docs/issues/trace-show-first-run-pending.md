---
relations:
  - role: spec
    target: docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
---

# 首次运行诊断查询仍直接返回 QueryPending

## 现象

新接入的仓库里第一次运行 `concord trace show <path>`、`trace gaps` 或 `review render`（不带 `--fresh`），命令立即退出 1，返回 `QueryPending`，`details.refresh` 为 `requested`。agent 按 skill 在会话开始时运行这些命令，第一次调用总要读懂错误再重试。

`src/query-cache.ts` 的 `cachedQuery` 启动后台刷新后，没有投影就立即抛出 `QueryPending`。

## 期望

按[首次运行](../feature/local-data-engine/use-case/query-asynchronous-projections.md#first-run)实现：没有投影时等待这次后台刷新结束，再读取它发布的投影输出；刷新失败、超时或 `--dry-run` 时才返回 `QueryPending`。查询进程不扫描，中断不取消刷新。验收见该 Use Case 的验收方式，完成后以 `--reason` 关闭。
