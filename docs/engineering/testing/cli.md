# 测试命令

`test` 直接调用固定版本的官方 Bun，`bench` 独立调用 Mitata。工具职责见[测试引擎](architecture.md#bun-测试引擎)。

## 测试入口

```sh
bun run test
bun run test test/domain/issue-close-links.test.ts
bun run test --test-name-pattern='close refuses'
bun run test --changed=origin/master
bun run test --shard=1/16
```

文件、标题、改动与分片选择使用 Bun 原生语义。文档、共享支持代码、依赖或运行配置变化后显式运行全套；交付说明写明选择范围。测试不触发类型检查、lint 或 benchmark，这些任务分别调用，见[检查入口](README.md#检查入口)。

可选官方报告：

```sh
bun run test --reporter=junit --reporter-outfile=.test-results/junit.xml --timings=.test-results/timings.json --update-timings
```

使用独立输出路径区分不同运行，保留原始报告与退出码。`--timings` 可读取官方耗时供调度使用，`--update-timings` 写回本次观测，不是独立的执行完成证明。零匹配与报告生成遵循上游行为。

CI 在 `ubuntu-24.04` 上运行十六个官方分片。故障注入单独运行 `CONCORD_NATIVE_TEST_HOOKS=1 bun run test test/process/hawdb-native.test.ts`，依赖的生产与测试绑定由准备任务下载和校验。

## 并发

默认 `--parallel` 使用 Bun 的 CPU 数策略；需要限制文件 worker 时直接传 `--parallel=8`。`--max-concurrency` 只控制文件内并发，与文件 worker 数不同。文件隔离、文件内串行，Fixture 主动回收自己的资源。

不设置内存或 swap 上限，不维护仓库级运行队列。交付者避免测试与性能采样同时运行；负载导致的超时或连接重置在空闲机器上复跑后再归因。
