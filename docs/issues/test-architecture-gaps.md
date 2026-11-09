# 测试集与测试架构的差距

## 现象

固定 Bun 1.4.4 的官方测试入口在 Linux x64、AMD Ryzen 7 5800X 上运行 `bun run test --parallel=8`：327 文件、827 测试，墙钟 494.86 秒，超过[成本与稳定](../engineering/testing/README.md#成本与稳定)的单机 300 秒目标。该次在使用异步原生句柄候选的隔离副本中运行，821 通过、6 跳过、0 失败；正式原生发行与 Darwin 验收不包含在此结论中。

官方 timings 中 `machine-schema.test.ts` 为 84.684 秒，`shared-view-fixture.test.ts` 为 79.463 秒，`shared-service.test.ts` 为 78.229 秒，均超过单文件 60 秒目标。原始报告在 `/tmp/concord-async-full-verified-1110-timings.json`，完整日志和 JUnit 在同前缀的 `.log` 与 `.xml` 文件中。

## 期望

测试使用[官方 Bun 调度](../engineering/testing/architecture.md#bun-测试引擎)，不恢复自写进程池、内存准入或统计框架。按[拆分慢测试](../engineering/testing/use-case/split-slow-test.md)下沉重复领域情形、减少重复启动，保持原有业务与跨进程保证。空闲机器上的完整通过运行及 CI 分片墙钟满足成本目标后关闭本 Issue。
