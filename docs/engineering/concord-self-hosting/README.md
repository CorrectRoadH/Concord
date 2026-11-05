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

当前 checkout 可由当前构建的项目本地 Concord 完成 `doctor`、`check`、`test list`、`trace show/check` 与 `review`；TypeScript 类型检查和相关测试通过。


## 开始开发

源码构建需要 Node.js 24.15+、pnpm 11.18.0、Git、Rust 1.97.1 和本机 C 链接工具链。

```sh
git clone https://github.com/CorrectRoadH/Concord.git
cd Concord
pnpm install --frozen-lockfile # 安装项目固定版本的 vp
rustup toolchain install 1.97.1 --profile minimal
pnpm exec vp build
pnpm exec vp run concord --help
pnpm exec vp run check
```

`pnpm check`（也可通过 `vp run check` 调用）是唯一的检查入口，检查顺序与产物使用见[构建与检查入口](#构建与检查入口)。

运行 `pnpm concord trace show local-sdlc` 可从源码查看关联。

没有全局安装 Vite+ 时使用 `pnpm exec vp`。`vp install` 通过固定版本的 pnpm 管理依赖。

按文件、用例或分片选择测试的参数见[构建与检查入口](#构建与检查入口)。只跑部分测试不能代替完整检查。

`vp build` 的生产构建钩子准备完整发行产物。Vite+ 内置的 `vp check` 和 `vp test` 不调用项目脚本。任务缓存关闭；局部检查不替代完整验收。

参与开发前请阅读[开发规则](../../../AGENTS.md)与[项目品味](../../taste.md)。

## 构建与检查入口

项目使用固定版本的 Vite+ 管理任务，依赖安装由 `vp install` 委托固定版本的 pnpm。未全局安装时以 `pnpm exec vp` 调用。

`pnpm check`（等价于 `vp run check`）是唯一的检查入口，满足 [用 Concord 管理自身](#用-concord-管理自身)。默认运行完整门禁，日常开发和 CI 使用同一条命令，不提供只做部分检查的入口。

开发检出中没有 `dist/`：日常开发、门禁和测试都运行源码，一个检出只有源码这一个安装身份，CLI 与工作区服务不会因新旧产物并存而冲突。门禁开始时发现检出中存在 `dist/` 即以 `DistInCheckout` 失败，提示删除。安装包只在检出之外构建。

| 阶段 | 内容 |
| --- | --- |
| 静态检查 | 源码、测试与脚本类型检查与 `check:selfhost` 并行执行 |
| 测试 | 全部测试层运行源码，与静态检查并行执行，按下文并发；CLI 子进程与 `pnpm concord` 的启动方式相同 |
| 打包 | 唯一的打包测试用 `vp build --out <临时目录>` 构建安装包，打包、安装一次，核对文件清单并从安装包启动 |

门禁不复制源码、不另建 checkout。门禁检查的是 checkout 当前的工作区，包括其它 agent 尚未提交的改动。

`pnpm check` 接受 `--test-name-pattern=表达式`、`--test-shard=序号/总数` 与测试文件路径。给出文件或过滤条件时，静态检查仍完整执行，只运行选中的测试；结果不能替代完整门禁。未指定文件时递归发现 `test/` 下的 `*.test.ts` 与 `test/e2e/` 下的 `*.e2e.ts`。CI 每个分片运行 `pnpm check --test-shard=序号/4`，分片并集覆盖完整测试集。

其它入口不是检查：`vp build --out <目录>` 把完整安装包构建到检出之外的目录，目录位于检出内时以 `BuildOutputInCheckout` 拒绝；`vp dev` 只启动 Web 开发服务器；`pnpm concord` 运行源码 CLI。发布流程、打包测试与[性能对照](performance.md)各自构建到自己的临时目录，互不共享，不需要本机构建锁。`vp run test:e2e:agent` 运行自然语言用例，使用环境中的模型配置，需要显式授权，不属于日常门禁。

测试的质量标准、分层、fixture 与成本上限见[测试架构](test-architecture.md)；资源归属、并发、安装共享与失败诊断见[测试执行与浏览器验收](testing.md)。报告写入每次调用独立的 `.test-results/run-*`，CI 按分片上传。

构建用固定版本的原生 tsc 做完整类型检查，并输出声明与 sourcemap，构建与运行时使用同一编译器版本。为保持启动性能，构建只改写生成的 JS：把 Effect namespace import 改为窄化导入，每处替换保持原换行数。sourcemap 先解码为绝对坐标，删除被改写行的映射后重新编码，保留其余映射。不改写源文件，不跳过声明检查。

### 原生绑定复用

`vp build` 每次清空输出目录，原生产物按以下顺序取得，第一项命中即停止。每一项都经 `--prebuilt` 的身份校验：target、ABI、HawDB revision、源码摘要、锁文件摘要、二进制与许可证摘要全部一致才使用。

1. 本机共享缓存 `${XDG_CACHE_HOME:-~/.cache}/concord/native/<源码摘要>-<锁文件摘要>/<target>/`，同一台机器的所有 checkout 与 worktree 共用。
2. 本仓库 GitHub Release `native-<源码摘要前 16 位>` 中的 `concord-native-<target>.tar.gz`。下载后校验，写入共享缓存。设置 `CONCORD_NATIVE_OFFLINE=1` 时跳过下载。
3. 用固定 Rust 工具链编译，结果写入共享缓存。

下载失败、产物缺失或校验不一致时进入下一项，并输出原因，不中断构建。发布流程不使用前两项，始终从源码编译要发布的原生产物。按摘要的 Release 由手动触发的 `native` workflow 为每个 target 编译并发布；本地构建与 CI 只读取它。

任务结果不缓存，定向结果不能替代完整验收。Vite+ 的内置 `check` 与 `test` 不代表本项目同名脚本。开发服务器不运行发行准备。

## 从源码运行

开发时用 `pnpm concord <参数>` 直接运行当前 checkout 的源码 CLI，等价于 `node --import tsx src/entry/cli/entry.ts`。它不需要 `vp build`，也不需要全局安装的 Concord；依赖由 `vp install` 准备。源码 CLI 用于日常操作、调试与全部测试，交付门禁 `pnpm check` 同样运行源码。

| 方面 | 规则 |
| --- | --- |
| 原生绑定 | 源码运行取自经身份校验的本机共享缓存，构建产物取自包根，校验规则相同。只有 `native/hawdb` 或其锁文件变化时才需要重建，命令为 `pnpm exec vp run build:native`；缺失时返回 `HawdbUnavailable` 并提示该命令 |
| 子进程 | 运行模式由一个模块统一判断。源码模式下，查询、扫描与编辑器子进程使用同一 loader 启动对应的 `.ts` 入口；安装包模式启动包内的 JavaScript 入口 |
| 安装身份 | 源码模式的安装身份是检出位置，安装包模式使用产物摘要。源码模式的服务记录启动时的源码摘要；同一检出的调用发现运行中服务的源码摘要与当前不同时，先停止它并等待完全退出，再启动新服务，不报 `WorkspaceServerVersionConflict`。缓存身份包含源码摘要，源码变化后不复用旧缓存 |
| Web 资源 | 源码模式下，工作区服务通过 Vite 从 `web/` 源码即时编译 Web 工作台与 PR 预览，不需要 `vp build`；安装包模式读取包内的编译结果 |

验收：没有全局 Concord、没有 `dist/`，只有共享缓存中的原生产物时，`pnpm concord --json --dry-run check`、`pnpm concord docs check --json` 与 `pnpm concord trace show <path> --json` 在本仓库正常运行。

## 技术栈

本节约束 Concord 自身的维护代码。

1. 实现、测试和构建脚本采用严格 TypeScript，执行与副作用通过 Effect 组织。不添加手工维护的 JavaScript，不绕过类型检查；编译输出和 JavaScript 消费者兼容 fixture 除外。
2. Effect 依赖精确固定，使用 API 前读取安装包指引。不可信边界严格 Schema 解码并返回具名失败。
3. 唯一原生例外是 `native/hawdb`：Rust N-API 桥接、链接胶水、字节转换、预算执行与固定 revision 的目录所有权锁适配。领域决策、来源核验、测试和构建编排仍属 TypeScript/Effect。
4. 本条约束 Concord 自身。接入项目的语言、包管理器和运行时由其自行选择。

## 仓库文档入口

根目录的 README 面向产品使用者，`AGENTS.md` 提供 coding agent 的开发入口。产品行为、架构、视觉规范和工程说明放在 `docs/` 的所属页面；领域术语只由 `concepts.md` 定义，不另设根目录上下文或设计说明副本（[一件事只写一次](../../taste.md#t-3)）。

[来源与第三方声明](../../notices.md)随 `docs/` 进入发行包；许可证原文和自动生成的第三方材料留在各自源码或构建产物中。发行与测试生成的压缩包是产物，不作为仓库文档保留。

## 用 Concord 管理自身

Concord 用自己的流程开发和验收自己。

1. 新功能先声明目标 Feature 与完整 Use Case，重要方案经 Design 比较和裁决。
2. 验收测试在声明旁关联 Spec。交付必须通过 `pnpm check`，测试按[构建与检查入口](#构建与检查入口)使用产物并验证公开 CLI。
3. Concord 的 check、trace 与 review 用于检查自身关系，不虚构测试关联或完成状态。

## 协作与授权

多个任务并行修改同一个仓库，对外操作需要明确授权。

1. 保留其他任务的改动，控制写入范围。
2. 未经明确授权不得 push、发布、操作生产、调用付费模型或发送外部消息。
3. 破坏消费者兼容、改变持久数据含义、重划资源所有权或信任边界、回滚依赖协调迁移的方案，必须先完成独立设计挑战：由未参与方案的 reviewer 只读审查并给出书面结论，存在未解决的阻断意见时不得定案。
