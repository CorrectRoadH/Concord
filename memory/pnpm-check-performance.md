---
format: concord.document/v1
id: pnpm-check-performance
title: pnpm check 的并发、归档复用与完整验收测量
createdAt: 2026-10-23T05:19:58.549Z
kind: memory
memoryKind: insight
state: current
epoch: 0
promotions: []
history: []
---

# pnpm check 的性能测量与隔离

## 范围与方法

保留全部测试、原有断言和源码关联标记，不新增跳过；保留打包公开 CLI、真实安装与隔离 Git 消费者验证（C-006.2）。优化前测量、优化后按相同方法复测（C-014.3）。所有产物来自固定 Effect/TypeScript 依赖和预编译原生绑定，不修改产品行为。

环境：AMD Ryzen 7 5800X（16 逻辑 CPU）、Linux x64、Node v24.19.0、pnpm 11.18.0、32GB 内存。机器存在其它任务，文件系统缓存和负载未冻结；全量结果用于报告实际完成时间，不冒充正式 CLI 性能预算验收。

原始入口以一个 Node 测试文件进程串行执行。新入口每次真实打包一次、默认并发四个隔离文件进程；`CONCORD_TEST_CONCURRENCY` 可显式覆盖。每个消费者仍真实安装自身依赖，使用 `--package-import-method=copy` 隔离故意破坏安装文件的测试，避免硬链接污染 pnpm store 或其它消费者。

Node TAP 原样保留，额外记录逐文件 summary（测试与 hooks，未含子进程模块启动）及总测试阶段时长。shell time 记录整个 `pnpm check` 的构建、类型检查、打包、测试总耗时。原始数据在 `/tmp/pc-first-full-files.jsonl`、`/tmp/pc-final-files.jsonl`，交接报告 `/tmp/pc-impl-report.md`。

## 根因与改动

- 默认全文件串行，使独立临时目录、动态端口的测试无法重叠执行；保留进程隔离可隔离 cwd 和环境变量。
- 原先 18 个测试文件各自生成发布归档，部分文件还会多次调用。统一复用本轮归档，每个消费者保持独立安装和可修改文件副本。
- 外部 adapter 等子进程 fixture 反复加载 Effect 总入口。改为固定版本的精确子模块导入，保持协议、超时及断言不变。
- 诊断等待改为轮询实际就绪状态；两个编辑器清理测试用真实 spawn 通知替代固定 150ms。View 写入后等待新 Feature 出现在异步投影中，再执行原有文档数量断言。
- 共享 checkout 的其它构建曾在测量期间改写 dist，造成安装包与本地查询上下文的身份不同。该轮测量作废；最终使用独立依赖与 dist 的冻结临时 worktree，未覆盖其它任务改动。

## 已完成测量

历史 Issue 记录：原串行检查在约 57 分钟仍未结束，任务契约记录超过 60 分钟后停止，已报告测试时间约 56 分钟；没有完成的完整基线。

代表性三个文件的原始串行测量为 194.85s：3 通过、1 失败、1 既有跳过。外部 adapter 在 JSON 解析处提前失败，未保留其底层 stderr，不能把它当作完成吞吐基线或断言其确切根因。归档复用后、收窄 fixture 导入前的串行测量为 301.77s：4 通过、0 失败、1 既有跳过；后者完整执行了 adapter 用例，两组不能直接作速度比。

fixture 启动：前后各预热一次，交错各采七次，轮换先后顺序。总入口导入 p50 258.21ms、max 269.77ms；子模块导入 p50 197.52ms、max 214.93ms，中位数减少 23.5%。两组 max/p50 均小于 2。原始数据 `/tmp/pc-fixture-startup.json`。

归档调用：同样预热后交错七次。重新打包 p50 4954.19ms，范围 4816.86–5864.20ms；复制复用归档 p50 10.46ms，范围 9.22–275.62ms。复制组在并发负载下波动超过 2 倍，保留为诊断数据，不判为有效正式预算验收。数据 `/tmp/pc-pack-startup.json`，复现源 `/tmp/pc-pack-bench.ts`（放入工作树 scripts 目录运行）。

首轮完整检查在干净冻结快照 5c69b2f 完成：总计 1553.07s（25分53.07秒），测试阶段 1533.52s，102 个文件、496 项测试，488 通过、2 失败、6 既有跳过，退出码 1。文件 summary 时间相加为 5978.68s，属于重叠时间，不能代替总 elapsed。日志 `/tmp/pc-first-full-check.log`。

新入口冒烟 5 项通过；故意失败探针保留失败并退出 1；SIGINT 探针退出 130，真实子进程退出且运行归档目录全部回收。

## 失败定位与边界

首轮两项失败：View 测试把已有的历史空投影当成写入后投影；写作缓存测试暖读仍加载 prose parser。View 已以实际 Feature 就绪条件修正，保留原断言和 65 秒边界。四文件并发定向复测 42.67s：30 通过、1 失败，仅剩写作缓存原断言。

写作缓存问题也在独立串行运行复现。`src/writing.ts` 在读取 writing findings 缓存前，对文档执行 `withoutStepMarkers`。初始化模板 `docs/_template/use-case/README.md` 含 `{#run-red}` 示例，因此暖读也加载 Markdown parser。仅在临时诊断消费者去掉该示例后，第二次暖读不再加载 parser，476 条 findings 完全相同；正式测试未删除或缩小输入，断言未修改。证据 `/tmp/pc-writing-parser-diagnosis.json`。需要产品路径延迟这项预处理到缓存未命中时，同时保持原始来源摘要；该产品修复超出本任务仅允许 src 测试支持 seam 的范围，因此保留为未解决项，不能宣称全量绿色。

## 最终复测

2026-10-23 最后一轮完整执行：`CONCORD_NATIVE_ARTIFACTS=/tmp/concord-native2 CONCORD_TEST_TIMINGS=/tmp/pc-final-files.jsonl pnpm check`，冻结快照 e648cb9（本任务改动，与共享工作树其它改动隔离）。总耗时 883.61s（14分43.61秒），测试阶段 865.82s。102 个文件、496 项测试：489 通过、1 失败、6 既有跳过，0 取消，退出码 1。唯一失败是上述写作缓存暖读断言；View 文件 8 项全通过。构建及测试、脚本的严格类型检查通过。

逐文件 summary 相加 3380.74s（约56分20.74秒），属于并行重叠时间。完整 CSV `/tmp/pc-final-file-durations.csv`，原始 summary `/tmp/pc-final-files.jsonl`，汇总 `/tmp/pc-final-summary.json`，日志 `/tmp/pc-final-check.log`，shell time `/tmp/pc-final-check.time`。首轮与末轮机器负载不同；本轮为明确报告的实际完成时间，不把波动全部归因于代码，也不宣称全量绿色或正式性能预算验收通过。

代码提交 d0d9b62、b24d172、5c69b2f、285f979；未执行 push。保持全部原断言和标记；6 个跳过均来自既有平台、原生 hook 或 Cargo linker 能力条件。收尾记录见 `/tmp/pc-impl-report.md`。
