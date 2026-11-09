# 测试集与测试架构的差距

## 现象

固定 Bun 1.4.4 的官方测试入口在 Linux x64、AMD Ryzen 7 5800X 上运行 `bun run test --parallel=8`：325 文件、823 测试，墙钟 518.09 秒，超过[成本与稳定](../engineering/testing/README.md#成本与稳定)的单机 300 秒目标。该次 810 通过、6 跳过、7 失败，另有一个清理错误，不能作为通过的性能参照。

官方 timings 中 `shared-service.test.ts` 为 88.994 秒，`machine-schema.test.ts` 为 87.151 秒，`shared-view-fixture.test.ts` 为 85.273 秒，均超过单文件 60 秒目标。原始报告在 `.test-results/migration-timings.json`，失败日志在 `/tmp/concord-final-test-1109.log`。

## 期望

测试使用[官方 Bun 调度](../engineering/testing/architecture.md#bun-测试引擎)，不恢复自写进程池、内存准入或统计框架。按[拆分慢测试](../engineering/testing/use-case/split-slow-test.md)下沉重复领域情形、减少重复启动，保持原有业务与跨进程保证。空闲机器上的完整通过运行及 CI 分片墙钟满足成本目标后关闭本 Issue。
