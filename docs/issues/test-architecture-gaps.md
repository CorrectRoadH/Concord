# 测试集与测试架构的差距

## 现象

[测试架构](../engineering/testing/README.md)按可观察的边界分层：进程层只保留[跨进程保证](../engineering/testing/README.md#跨进程保证)，CLI 层使用[进程内 CLI](../engineering/testing/architecture.md#进程内-cli)，只读的服务用例使用[共享服务](../engineering/testing/architecture.md#共享服务)。三者的基础设施已经建成，但测试还没有全部迁过去。

2026-11-07 完整门禁 run-SnO3yY 全部通过，墙钟 500 秒，上限 300 秒。各层文件耗时之和（括号内为维护预算）：纯函数 90 秒（60）、仓库内 401 秒（300）、CLI 411 秒（60）、进程 2384 秒（500）、浏览器 485 秒（400）。浏览器只有一个 worker，从开始跑到结束，是墙钟的关键路径；在 15 GiB 的参照机上，增加浏览器 worker 会挤占 Node 并发，墙钟反而变长（`/tmp/concord-closure/lead6-critical-path.md`）。CI 每片 390 到 480 秒，上限 120 秒。

## 差距

按[成本与稳定](../engineering/testing/README.md#成本与稳定)的顺序与容量条件：

- 浏览器：一个 worker 跑 42 个用例约 485 秒，平均每例约 13 秒，预算 240 秒。先按用例拆出恢复冻结提交、等待服务刷新与用例本身的耗时，再按[浏览器与诊断](../engineering/testing/architecture.md#浏览器与诊断)的收束与代际规则跳过不必要的恢复，并把不需要真实浏览器的断言下沉。
- 归档：归档准备在负载下约 340 秒，构建摘要覆盖全部输入、没有按部分缓存，改文档或 CLI 源码都整包重建（[共享构建缓存](../engineering/build/architecture.md#共享构建缓存)）；打包测试要等源码 Node 测试结束才开始，`release-package` 单文件 66 秒超过 60 秒。归档准备与静态检查的内存峰值尚未单独测量。
- Node：文件耗时之和约 3410 秒（不含打包），CLI 层 411 秒（预算 60），进程层 2384 秒（预算 500）；perf-coverage 合并文件峰值 2.499 GiB 超出 2 GiB 类别预算。改为内存准入后参照机并发约 5，迁移完成前本机 Node 用时会变长。
- CI：仍是 4 个分片且打包测试混在分片中；改为 8 个源码分片与单独的打包任务。

## 期望

完整门禁与 CI 分片的墙钟满足[成本与稳定](../engineering/testing/README.md#成本与稳定)的上限。迁移按下沉时保持旧保证的规则进行，完成后以 `--reason` 关闭本 Issue，写明迁移提交与最终门禁结果。
