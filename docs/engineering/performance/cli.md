# 测量命令

benchmark 直接使用 Bun 与 Mitata。包脚本只提供全量入口，定向运行选择对应的 TypeScript 文件；工具参数与结果格式由上游拥有（[用现成的能力，不重写](../../taste.md#t-10)）。

## 常用组合

```sh
# 运行全部业务基准场景
bun run bench

# 运行一个 Feature 的场景
bun --no-env-file --config=/dev/null bench/local-sdlc.bench.ts

# 以 Bun profiler 定位同一场景的热点
bun --no-env-file --config=/dev/null --cpu-prof bench/local-sdlc.bench.ts
```

场景直接用 Mitata 注册，入口调用 `run({ throw: true })`。需要 JSON 输出或名称过滤时，直接使用 Mitata 的 `format: 'json'` 与 `filter` 选项，不另外实现命令行解析、报告协议或选择器。调用方式由[场景与入口](architecture.md#场景与入口)定义。

所有场景失败都传播为运行失败。零匹配、空报告和没有完成的异步工作不能作为预算通过证据。预热与采样次数由 Mitata 决定，不通过自研 quick 模式改变验收含义。

## 消费者

使用场景自有的固定数据或私有临时仓库，按场景需要准备缓存与服务。输入规模在场景与预算页写明。测量结束或失败后回收资源，不在外部仓库原地清缓存或恢复文件。

来源提交、输入摘要与环境随结论记录。不同提交的对照分别准备来源后运行相同文件，不由 benchmark 命令构建、缓存或修补历史归档。

## 测量记录

以 Mitata 官方输出作为原始记录。记录结论时列出：

- 场景名、源码提交或未提交 diff，以及输入来源与规模。
- Bun 与 Mitata 版本、CPU、操作系统、架构，以及测量时已知的负载。
- 冷暖状态、计时边界、工具报告的统计与诊断。
- 适用预算的位置，以及超限、缺失或不可比的原因。

原始报告不改写为 `pass` 与 `acceptance` 两套结论。交付者按[统计与结果](architecture.md#统计与结果)对照预算，不另设预算检查命令。Mitata 成功退出不代表预算通过，缺少必需证据时不能声称达标。

CPU profile 直接使用 Bun 的输出，用于定位函数热点。父进程的 profile 不覆盖服务或其它子进程；需要它们的证据时单独采集。
