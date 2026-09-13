---
format: concord.document/v1
id: concord-self-hosting
title: Concord 自举维护
createdAt: 2026-09-13T11:00:38.822Z
kind: engineering
---

# Concord 自举维护

本工程主题规定 Concord 如何用已构建并全局 link 的自身 CLI 维护本仓库契约。仓库中的 Markdown owner 与真实测试注释共同接受 `doctor`、`check`、`trace` 和 `review` 验证；最终质量门仍是从构建、类型检查到打包消费者 smoke 的 `pnpm check`。

## 目标

- 自举配置使用公开 runner argv，不依赖 shell 或 NiceEval。
- 测试声明直接绑定 `node:test`，执行回调通过 Effect。
- sourceFiles 纳入测试支持、TypeScript 配置、包清单与锁文件。
- smoke 只读检查当前仓库的配置与可扫描注释，不递归运行 `pnpm check`，也不修改当前仓库。

## 完成条件

当前 checkout 可由 link 的 `concord v0.3.0` 完成 `doctor`、`check`、`test list`、`trace show/check` 与 `review render`；TypeScript 类型检查和相关测试通过。
