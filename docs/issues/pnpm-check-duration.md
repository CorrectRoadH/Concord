---
relations:
  - role: investigation
    target: memory/pnpm-check-performance.md
---

# pnpm check 超过五分钟的门禁上限

## 观察

2026-10-23 在 AMD Ryzen 7 5800X、Linux x64、Node v24.19.0 上运行 `pnpm check`，测试阶段 `node --test --test-concurrency=1` 顺序执行全部 `test/*.test.ts`，57 分钟后仍未结束。已报告用例的耗时合计约 56 分钟。

耗时最长的用例：

| 用例 | 耗时 |
| --- | ---: |
| packed write deadline produces uncertain outcome and a fresh close observes applied state | 127.5s |
| packed external adapter preserves static relations and rejects dishonest protocol/report outcomes | 95.8s |
| C3 C4 C5: code counts once and action words describe repeated surface observations | 62.4s |
| packed repository CLI binds process requests, rejects invalid responses and reaps nested groups | 53.1s |
| Web structured actions use the same Design decision gate | 52.9s |
| real browser creates a Feature, edits Markdown, preserves conflicts and opens Git changes | 52.4s |

`view-server.test.ts` 运行时持续输出 `Concord view slow request ... eventLoopDelayMs: 283`。

## 影响

宪法 C-006 要求交付通过 `pnpm check`。一次检查接近一小时，修改文档后的验收和 Agent 的交付循环都被拖慢，Agent 也容易把它当成卡死。

## 待判断

- 哪些文件可以并发执行，`--test-concurrency=1` 是否必要。
- 打包消费者的安装与构建是否可以在文件之间复用。
- 长用例中的等待是否来自固定超时而不是事件。

## 2026-10-23 处理结果

已实施本轮唯一发布归档、独立消费者物理安装副本、默认四文件进程并发、fixture 的 Effect 子模块导入，以及真实 spawn/目标投影就绪等待。未删除测试或断言，未修改源码测试标记，未新增跳过；仍通过构建与打包的公开 CLI 验证隔离 Git 消费者。真实远端写入 deadline 未缩短。

最后完整检查总耗时 **883.61s（14分43.61秒）**，102 个文件、496 项测试：**489 通过、1 失败、6 既有跳过**，退出码 1；构建和严格类型检查通过。原观察是约57分钟仍未完成，没有可比较的完成基线；机器负载与文件系统缓存未冻结，不将这一时间差冒充严格配对的预算验收。

首轮完整检查为25分53.07秒，488通过、2失败、6跳过。View 测试读到历史空投影的时序问题已修正，末轮该文件8项全过。唯一剩余失败是写作缓存暖读仍加载 Markdown parser，独立串行亦复现：初始化 Use Case 模板中的步骤示例触发缓存查询前的 `withoutStepMarkers`。正式测试及其原断言保留；产品路径修复超出本任务限定的 src 测试 seam 范围，尚未处理，因此不能宣称全量绿色。

详细方法、前后采样、复制组波动限制、源码位置和诊断对照由 [工程测量](../../memory/pnpm-check-performance.md) 拥有。交接报告 `/tmp/pc-impl-report.md`，完整逐文件数据 `/tmp/pc-final-file-durations.csv`；日志 `/tmp/pc-final-check.log`。代码提交 d0d9b62、b24d172、5c69b2f、285f979，未执行 push。

## 2026-10-31 现状

测试拆分与下移后，门禁在 t-speed 交付时为 297.85 s。工作区服务加入后，同一参照机器上默认并发（Node 8 个文件、浏览器 4 个 worker）的完整门禁约 355 s：源码层与构建阶段并行约 60 s，构建产物上的测试约 296 s。单个测试文件都已不超过 60 s，测试阶段启用了调用内编译缓存。

[测试架构](../engineering/concord-self-hosting/test-architecture.md#成本与稳定)的 5 分钟上限按默认设置测量，显式提高 `CONCORD_TEST_CONCURRENCY` 得到的耗时不作为验收；提高并发也会加重负载敏感的失败。剩余成本主要是构建产物上的进程层测试反复启动 CLI 与服务进程，继续把领域情形下移到源码层。

