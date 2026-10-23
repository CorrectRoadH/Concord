---
format: concord.document/v1
id: concord-self-hosting
title: Concord 自举维护
createdAt: 2026-09-13T11:00:38.822Z
kind: engineering
---

# Concord 自举维护

本工程主题规定 Concord 如何用已构建的项目本地 CLI（`vp run concord`）维护本仓库契约。仓库中的 Markdown owner 与真实测试注释共同接受 `doctor`、`check`、`trace` 和 `review` 验证；最终质量门是从构建、类型检查到打包消费者测试的 `vp run check`。

## 目标

- 自举配置使用公开 runner argv，不依赖 shell 或 NiceEval。
- 本仓库测试由配置的 `node:test` runner 执行，回调通过 Effect。关联由 Concord 标记拥有。
- sourceFiles 纳入测试支持、TypeScript 配置、包清单与锁文件。
- smoke 只读检查当前仓库的配置与可扫描注释，不递归运行 `vp run check`，也不修改当前仓库。
- 性能测量与 profile 以当前构建测量本仓库 commit 的独立 clone 或合成大仓库，预算从契约 owner 读取，入口为 `vp run bench` 与 `vp run bench:profile`。

## 完成条件

当前 checkout 可由当前构建的项目本地 Concord 完成 `doctor`、`check`、`test list`、`trace show/check` 与 `review render`；TypeScript 类型检查和相关测试通过。

## 构建与检查入口

项目使用固定版本的 Vite+ 管理任务，依赖安装由 `vp install` 委托固定版本的 pnpm。未全局安装时以 `pnpm exec vp` 调用。`vp run check` 与 `pnpm check` 执行相同的完整门禁，满足 [C-006](../../constitution.md#c-006)。

| 入口 | 检查范围与前提 |
| --- | --- |
| `vp run check:fast` | CLI 与 Web 源码类型，无需构建产物 |
| `vp build` | 原生引擎、CLI、repository 与 Web 的完整构建 |
| `vp run typecheck:built` | 当前构建上的 repository、测试与脚本类型检查 |
| `vp run test:built [files...]` | 当前构建上的全部或指定文件测试，每次只打包一次 |
| `vp run check` | 完整构建、其余类型检查和全部测试 |

测试入口接受 `--test-name-pattern=表达式` 和 `--test-shard=序号/总数`。选项和文件参数均由测试入口解析，未指定文件时自动发现全部 `test/*.test.ts`。CI 的分片集合须覆盖完整测试集，每片使用一份归档及独立安装的消费者。新增测试文件自动纳入完整门禁。

源码变化后必须重新构建，才能运行依赖产物的检查。任务结果不缓存，定向结果不能替代完整验收。Vite+ 的内置 `check` 与 `test` 不代表本项目同名脚本；项目验收使用 `vp run check`。`vp build` 先准备原生绑定、CLI 与 repository，再构建 Web 并补齐 Preview、P5 与许可证。开发服务器不运行发行准备。Node 原生测试 runner、外部消费者 adapter 及包身份校验保持各自职责。
