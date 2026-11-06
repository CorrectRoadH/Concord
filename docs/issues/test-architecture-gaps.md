# 测试集与测试架构的差距

## 现象

[测试架构](../engineering/testing/README.md)按可观察的边界分层：进程层只保留[跨进程保证](../engineering/testing/README.md#跨进程保证)，CLI 层使用[进程内 CLI](../engineering/testing/architecture.md#进程内-cli)，只读的服务用例使用[共享服务](../engineering/testing/architecture.md#共享服务)。三者的基础设施已经建成，但测试还没有全部迁过去。

2026-11-07 完整门禁 run-SnO3yY 全部通过，墙钟 500 秒，上限 300 秒。各层文件耗时之和（括号内为维护预算）：纯函数 90 秒（60）、仓库内 401 秒（300）、CLI 411 秒（60）、进程 2384 秒（500）、浏览器 485 秒（400）。浏览器只有一个 worker，从开始跑到结束，是墙钟的关键路径；在 15 GiB 的参照机上，增加浏览器 worker 会挤占 Node 并发，墙钟反而变长（`/tmp/concord-closure/lead6-critical-path.md`）。CI 每片 390 到 480 秒，上限 120 秒。

## 差距

- 浏览器测试 42 个用例约 485 秒，要降到 300 秒以内才能缩短墙钟。
- CLI 层仍有测试启动子进程或冷启动服务，耗时之和远超预算。
- 进程层仍在枚举输入组合；`shared-service` 单个文件 66 秒，超过 60 秒的单文件上限。

## 期望

完整门禁与 CI 分片的墙钟满足[成本与稳定](../engineering/testing/README.md#成本与稳定)的上限。迁移按下沉时保持旧保证的规则进行，完成后以 `--reason` 关闭本 Issue，写明迁移提交与最终门禁结果。
