# 测试集与测试架构的差距

## 现象

[测试架构](../engineering/testing/README.md)按可观察的边界分层：进程层只保留[跨进程保证](../engineering/testing/README.md#跨进程保证)，CLI 层使用[进程内 CLI](../engineering/testing/architecture.md#进程内-cli)，只读的服务用例使用[共享服务](../engineering/testing/architecture.md#共享服务)。三者的基础设施已经建成，但测试还没有全部迁过去。

2026-11-07 完整门禁 run-SnO3yY 全部通过，墙钟 500 秒，上限 300 秒。各层文件耗时之和（括号内为维护预算）：纯函数 90 秒（60）、仓库内 401 秒（300）、CLI 411 秒（60）、进程 2384 秒（500）、浏览器 485 秒（400）。浏览器只有一个 worker，从开始跑到结束，是墙钟的关键路径；在 15 GiB 的参照机上，增加浏览器 worker 会挤占 Node 并发，墙钟反而变长（`/tmp/concord-closure/lead6-critical-path.md`）。CI 每片 390 到 480 秒，上限 120 秒。

## 差距

按[成本与稳定](../engineering/testing/README.md#成本与稳定)的顺序与容量条件。最近一次完整门禁 run-nyz604（df2e0ed）全部通过，墙钟 519.5 秒；CI run 42330019903 九个任务全部通过，源码分片 149.8–350.2 秒，打包任务 269.4 秒：

- Node：关键路径。run-wuh04E 中源码 Node 测试 518.6 秒，文件耗时之和 2665 秒，有效并发约 5：每个文件统一按 2 GiB 准入，而 PSS 实测 p50 0.22、p95 1.15 GiB，实际“内存 × 时间”2063 GiB·秒，统一预留 5240 GiB·秒。按文件记录准入后并发可到 8，仍约 333 秒，超过 240 秒；剩下靠迁移：CLI 层与进程层降到各自预算。`test-adapters-consumer-2` 3.05 GiB、`source-web-cache` 2.84 GiB 超出 2 GiB。
- 浏览器：3 个 worker 并行，整套约 184 秒；worker 占用合计 533 worker 秒，超过 480。worker 的 PSS 峰值 2.06–2.10 GiB，预算按取整规则为 2.5 GiB。

## 期望

完整门禁与 CI 分片的墙钟满足[成本与稳定](../engineering/testing/README.md#成本与稳定)的上限。迁移按下沉时保持旧保证的规则进行，完成后以 `--reason` 关闭本 Issue，写明迁移提交与最终门禁结果。
