# 测试集与测试架构的差距

## 现象

[测试架构](../engineering/testing/README.md)按可观察的边界分层：进程层只保留[跨进程保证](../engineering/testing/README.md#跨进程保证)，CLI 层使用[进程内 CLI](../engineering/testing/architecture.md#进程内-cli)，只读的服务用例使用[共享服务](../engineering/testing/architecture.md#共享服务)。三者的基础设施已经建成，但测试还没有全部迁过去。

2026-11-07 完整门禁 run-SnO3yY 全部通过，墙钟 500 秒，上限 300 秒。各层文件耗时之和（括号内为维护预算）：纯函数 90 秒（60）、仓库内 401 秒（300）、CLI 411 秒（60）、进程 2384 秒（500）、浏览器 485 秒（400）。浏览器只有一个 worker，从开始跑到结束，是墙钟的关键路径；在 15 GiB 的参照机上，增加浏览器 worker 会挤占 Node 并发，墙钟反而变长（`/tmp/concord-closure/lead6-critical-path.md`）。CI 每片 390 到 480 秒，上限 120 秒。

## 差距

按[成本与稳定](../engineering/testing/README.md#成本与稳定)的三条链（参照机每条不超过 240 秒）：

- 浏览器链：一个 worker 跑 42 个用例约 485 秒，平均每例约 13 秒。先按用例拆出恢复冻结提交、等待服务刷新与用例本身的耗时，再按“没有差异不恢复”的规则改 fixture，并把不需要真实浏览器的断言下沉。
- 归档链：归档准备在负载下约 340 秒，缓存未命中，原因是摘要包含了 `docs/` 等不打进归档的输入，而且没有按部分缓存（[共享构建缓存](../engineering/build/architecture.md#共享构建缓存)）；打包测试要等源码 Node 测试结束才开始，其中 `release-package` 单文件 66 秒。
- Node 链：文件耗时之和约 3476 秒，CLI 层 411 秒（预算 60），进程层 2384 秒（预算 500）。改为内存准入后参照机约 5 个并发，迁移完成前本机 Node 链会比现在更长；CI 分片 Node 并发为 2，分片 Node 测试约 477 秒，主要靠这一层的迁移降下来。

## 期望

完整门禁与 CI 分片的墙钟满足[成本与稳定](../engineering/testing/README.md#成本与稳定)的上限。迁移按下沉时保持旧保证的规则进行，完成后以 `--reason` 关闭本 Issue，写明迁移提交与最终门禁结果。
