# Concord 自举维护

本工程主题规定 Concord 如何用当前 checkout 的 CLI（`pnpm concord`）维护本仓库 Spec。仓库中的 Markdown owner 与真实测试注释共同接受 `doctor`、`check`、`trace` 和 `review` 验证；最终质量门是包含构建、类型检查、自身 Spec 检查与打包消费者测试的 `pnpm check`。

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

项目使用固定版本的 Vite+ 管理任务，依赖安装由 `vp install` 委托固定版本的 pnpm。未全局安装时以 `pnpm exec vp` 调用。

`pnpm check`（等价于 `vp run check`）是唯一的检查入口，满足 [C-006](../../constitution.md#c-006)。默认运行完整门禁，日常开发和 CI 使用同一条命令，不提供只做部分检查的入口。

| 阶段 | 内容 |
| --- | --- |
| 构建 | 原生绑定按下文规则复用；CLI 与 Web 并行编译到 `dist` |
| 静态检查 | 源码、测试与脚本类型检查与 `check:selfhost` 并行执行 |
| 测试 | 不需要构建的层先运行，随后直接运行 `dist` 的 CLI 层、进程层与 e2e 浏览器测试，按下文并发执行 |

门禁不复制源码、不另建 checkout，测试也不为运行而打包安装；只有验证发布内容的打包测试打包并安装一次。门禁检查的是 checkout 当前的工作区，包括其它 agent 尚未提交的改动。`dist` 只由门禁与 `vp build` 写入，两者取得同一把本机锁：同一台机器同时只有一个写入 `dist` 的调用，后来者等待并输出前者的进程号与开始时间。日常开发运行源码，不需要 `dist`。

`pnpm check` 接受 `--test-name-pattern=表达式`、`--test-shard=序号/总数` 与测试文件路径。给出文件或过滤条件时，构建与静态检查仍完整执行，只运行选中的测试；结果不能替代完整门禁。未指定文件时递归发现 `test/` 下的 `*.test.ts` 与 `test/e2e/` 下的 `*.e2e.ts`。CI 每个分片运行 `pnpm check --test-shard=序号/4`，分片并集覆盖完整测试集。

其它入口不是检查：`vp build` 只构建，`vp dev` 只启动 Web 开发服务器，`pnpm concord` 运行源码 CLI。`vp run test:e2e:agent` 运行自然语言用例，使用环境中的模型配置，需要显式授权，不属于日常门禁。

测试的质量标准、分层、fixture 与成本上限见[测试架构](test-architecture.md)；资源归属、并发、安装共享与失败诊断见[测试执行与浏览器验收](testing.md)。报告写入每次调用独立的 `.test-results/run-*`，CI 按分片上传。

构建用固定版本的原生 tsc 做完整类型检查，并输出声明与 sourcemap，构建与运行时使用同一编译器版本。为保持启动性能，构建只改写生成的 JS：把 Effect namespace import 改为窄化导入，每处替换保持原换行数。sourcemap 先解码为绝对坐标，删除被改写行的映射后重新编码，保留其余映射。不改写源文件，不跳过声明检查（[决策依据](../../design/typescript-native/DECISION.md)）。

### 原生绑定复用

`vp build` 每次清空 `dist`，原生产物按以下顺序取得，第一项命中即停止。每一项都经 `--prebuilt` 的身份校验：target、ABI、HawDB revision、源码摘要、锁文件摘要、二进制与许可证摘要全部一致才使用。

1. 本机共享缓存 `${XDG_CACHE_HOME:-~/.cache}/concord/native/<源码摘要>-<锁文件摘要>/<target>/`，同一台机器的所有 checkout 与 worktree 共用。
2. 本仓库 GitHub Release `native-<源码摘要前 16 位>` 中的 `concord-native-<target>.tar.gz`。下载后校验，写入共享缓存。设置 `CONCORD_NATIVE_OFFLINE=1` 时跳过下载。
3. 用固定 Rust 工具链编译，结果写入共享缓存。

下载失败、产物缺失或校验不一致时进入下一项，并输出原因，不中断构建。发布流程不使用前两项，始终从源码编译要发布的原生产物。按摘要的 Release 由手动触发的 `native` workflow 为每个 target 编译并发布；本地构建与 CI 只读取它。

源码变化后必须重新构建，才能运行依赖产物的检查。任务结果不缓存，定向结果不能替代完整验收。Vite+ 的内置 `check` 与 `test` 不代表本项目同名脚本。开发服务器不运行发行准备。

## 从源码运行

开发时用 `pnpm concord <参数>` 直接运行当前 checkout 的源码 CLI，等价于 `node --import tsx src/entry/cli/entry.ts`。它不需要 `vp build`，也不需要全局安装的 Concord；依赖由 `vp install` 准备。源码 CLI 用于日常操作与调试，交付门禁仍是基于构建产物的 `pnpm check`。

| 方面 | 规则 |
| --- | --- |
| 原生绑定 | 源码运行取自经身份校验的本机共享缓存，构建产物取自包根，校验规则相同。只有 `native/hawdb` 或其锁文件变化时才需要重建，命令为 `pnpm exec vp run build:native`；缺失时返回 `HawdbUnavailable` 并提示该命令 |
| 子进程 | 运行模式由一个模块统一判断。源码模式下，查询、扫描与编辑器子进程使用同一 loader 启动对应的 `.ts` 入口；构建模式不变 |
| 安装身份 | 源码模式的安装身份是 `src/` 下 TypeScript 源码与原生产物的摘要，构建模式沿用产物摘要。两种模式的缓存身份不同，互不复用 |
| 构建资源 | Web 工作台、PR 预览导出等依赖构建资源的命令，在源码模式下返回 `BuildRequired` 并提示 `vp build`；Web 开发使用 `vp dev` |

验收：没有全局 Concord、没有 `dist/*.js`，只有原生产物时，`pnpm concord --json --dry-run check`、`pnpm concord docs check --json` 与 `pnpm concord trace show <path> --json` 在本仓库正常运行。
