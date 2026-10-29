---
format: concord.document/v1
id: concord-self-hosting
title: Concord 自举维护
createdAt: 2026-09-13T11:00:38.822Z
kind: engineering
---

# Concord 自举维护

本工程主题规定 Concord 如何用已构建的项目本地 CLI（`vp run concord`）维护本仓库 Spec。仓库中的 Markdown owner 与真实测试注释共同接受 `doctor`、`check`、`trace` 和 `review` 验证；最终质量门是包含构建、类型检查、自身 Spec 检查与打包消费者测试的 `vp run check`。

## 目标

- 自举配置使用公开 runner argv，不依赖 shell 或 NiceEval。
- 本仓库测试通过统一入口调度 Node 与 e2e runner，回调通过 Effect。关联由 Concord 标记拥有。
- sourceRoots 覆盖 `src`、`repository`、`web` 与 `scripts`；testRoots 覆盖 `test`。
- sourceFiles 纳入测试支持、TypeScript 配置、包清单与锁文件。
- smoke 只读检查当前仓库的配置与可扫描注释，不递归运行 `vp run check`，也不修改当前仓库。
- 性能测量与 profile 以当前构建测量本仓库 commit 的独立 clone 或合成大仓库，预算从 Spec owner 读取，入口为 `vp run bench` 与 `vp run bench:profile`。

## 完成条件

当前 checkout 可由当前构建的项目本地 Concord 完成 `doctor`、`check`、`test list`、`trace show/check` 与 `review render`；TypeScript 类型检查和相关测试通过。

## 构建与检查入口

项目使用固定版本的 Vite+ 管理任务，依赖安装由 `vp install` 委托固定版本的 pnpm。未全局安装时以 `pnpm exec vp` 调用。`vp run check` 与 `pnpm check` 执行相同的完整门禁，满足 [C-006](../../constitution.md#c-006)。

| 入口 | 检查范围与前提 |
| --- | --- |
| `vp run check:fast` | CLI 与 Web 源码类型，无需构建产物 |
| `vp build` | 原生引擎、CLI、repository 与 Web 的完整构建 |
| `vp run typecheck:built` | 当前构建上的 repository、测试与脚本类型检查 |
| `vp run check:selfhost` | 当前构建检查当前 checkout 的关系、生命周期与写作政策，不运行测试 |
| `vp run test:built [files...]` | 当前构建上的全部或指定文件测试，每次只打包一次 |
| `vp run test:e2e [files...]` | 当前构建上的确定性浏览器测试，无模型调用 |
| `vp run test:e2e:agent [files...]` | 显式授权后的自然语言用户流程，使用环境中的模型配置 |
| `vp run check` | 完整构建、其余类型检查、自身 Spec 检查和全部测试 |

测试入口接受 `--test-name-pattern=表达式` 和 `--test-shard=序号/总数`。未指定文件时自动发现 `test/*.test.ts` 与 `test/e2e/*.e2e.ts`，分别交给 Node 与 e2e。两类测试默认串行，`CONCORD_TEST_CONCURRENCY` 可显式覆盖并发。CI 的分片集合须覆盖完整测试集，每片使用一份归档及独立安装的消费者。新增测试文件自动纳入完整门禁。CI 在第一分片构建后执行 `check:selfhost`，任一检查失败均阻止门禁通过。

资源归属、失败诊断与自然语言适用范围见[测试执行与浏览器验收](testing.md)。报告写入每次调用独立的 `.test-results/run-*`，CI 按分片上传。自然语言用例单独执行，不要求日常本地门禁拥有模型凭据。

源码变化后必须重新构建，才能运行依赖产物的检查。任务结果不缓存，定向结果不能替代完整验收。Vite+ 的内置 `check` 与 `test` 不代表本项目同名脚本；项目验收使用 `vp run check`。`vp build` 先准备原生绑定、CLI 与 repository，再构建 Web 并补齐 Preview、P5 与许可证。开发服务器不运行发行准备。Node 原生测试 runner、外部消费者 adapter 及包身份校验保持各自职责。

## 从源码运行

开发时用 `pnpm concord <参数>` 直接运行当前 checkout 的源码 CLI，等价于 `node --import tsx src/entry.ts`。它不需要 `vp build`，也不需要全局安装的 Concord；依赖由 `vp install` 准备。源码 CLI 用于日常操作与调试，交付门禁仍是基于构建产物的 `vp run check`。

| 方面 | 规则 |
| --- | --- |
| 原生绑定 | 源码与构建产物都加载 `dist/native/<target>/`，校验规则相同。只有 `native/hawdb` 或其锁文件变化时才需要重建，命令为 `pnpm exec vp run build:native`；缺失时返回 `HawdbUnavailable` 并提示该命令 |
| 子进程 | 运行模式由一个模块统一判断。源码模式下，查询、扫描与编辑器子进程使用同一 loader 启动对应的 `.ts` 入口；构建模式不变 |
| 安装身份 | 源码模式的安装身份是 `src/` 下 TypeScript 源码与原生产物的摘要，构建模式沿用产物摘要。两种模式的缓存身份不同，互不复用 |
| 构建资源 | Web 工作台、PR 预览导出等依赖构建资源的命令，在源码模式下返回 `BuildRequired` 并提示 `vp build`；Web 开发使用 `vp dev` |

验收：没有全局 Concord、没有 `dist/*.js`，只有原生产物时，`pnpm concord --json --dry-run check`、`pnpm concord docs check --json` 与 `pnpm concord trace show <path> --json` 在本仓库正常运行。
