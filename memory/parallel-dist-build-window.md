---
format: concord.document/v1
id: parallel-dist-build-window
title: 并行 worker 共享 dist 的构建窗口
createdAt: 2026-10-01T09:26:49.116Z
kind: memory
memoryKind: insight
state: current
epoch: 0
promotions: []
history: []
---

# 并行 worker 共享 dist 的构建窗口

多个 worker 在同一工作树并行开发时，任一 worker 运行 `pnpm build` 或 `pnpm check` 都会先清空 `dist/`。其它 worker 正在运行的公开 CLI 测试因此报 `MODULE_NOT_FOUND`，全局 `concord`（链接到 `dist/entry.js`）也暂时不可用。

2026-10-01 repository-workflows 四个批次并行时，这一问题两次中断验收。改为父 agent 串行分配构建窗口后不再发生：窗口外 worker 只编辑并运行 `tsc --noEmit`，窗口内再运行 build、定向打包测试与 `pnpm check`。

一个 worker 的 build 失败也会清空 dist，阻断全部 worker；类型错误需要先由所属 worker 修复。
