---
format: concord.document/v1
id: pnpm-check-duration
title: pnpm check 在本机运行接近一小时
createdAt: 2026-10-23T03:49:01.461Z
kind: issue
state: draft
memoryRelations: []
adoptions:
  current: []
  history: []
history: []
---

# pnpm check 在本机运行接近一小时

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
