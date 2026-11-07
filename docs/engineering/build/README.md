# 构建与开发环境

维护者用本文档包准备开发环境、从源码运行 Concord，并把完整[归档](../../concepts.md#archive)构建到 worktree 之外。检查入口与测试见[测试](../testing/README.md)，性能测量见[性能测量](../performance/README.md)。

## 开始开发

开发需要[运行时版本](#运行时版本)指定的 Bun、运行 pnpm 与 Vite+ 所需的 Node.js、pnpm 11.18.0、Git、Rust 1.97.1 和本机 C 链接工具链。

```sh
git clone https://github.com/CorrectRoadH/Concord.git
cd Concord
pnpm install --frozen-lockfile # 安装项目固定版本的 vp
rustup toolchain install 1.97.1 --profile minimal
pnpm exec vp run concord --help
pnpm exec vp run gate
```

没有全局安装 Vite+ 时使用 `pnpm exec vp`。之后用 `vp install` 通过固定版本的 pnpm 管理依赖。

参与开发前请阅读[开发规则](../../../AGENTS.md)与[项目品味](../../taste.md)。

## 运行时版本

Concord 运行在 Bun 上。开发、测试、CI 与发版归档使用同一个 Bun 精确版本，唯一记录在仓库根目录的 `.bun-version` 中；`package.json` 不声明 `engines`。启动与模块加载是高频 CLI 的成本，交付按真实命令测量，不以空进程或模块加载的耗时代替产品性能验收（[快到每次都愿意跑](../../taste.md#t-7)）。

产品代码可以使用该版本 Bun 的 API，以及它实现的 Node.js 兼容 API。pnpm 与 Vite+ 等开发工具仍运行在 `.node-version` 固定的 Node.js 上；测试工具宿主与被测 Concord 进程分开，Concord 代码使用 Bun。升级产品运行时更新 `.bun-version`，交付前跑完整门禁与打包测试。

只交付 Herdr mod 时运行 `pnpm build:herdr`，生成目录直接随 Git 提交分发，不需要完整归档或 CLI Release，见[独立交付 Concord mod](use-case/share-herdr-mod.md)。

## 怎样工作

开发用的 worktree 中没有 `dist/`：日常开发运行源码，测试同样运行源码，Web 产物与原生绑定来自 worktree 外按输入摘要共享的缓存。worktree 只有源码这一个安装身份，CLI 与工作区服务不会因新旧产物并存而冲突。

`pnpm concord <参数>` 直接运行当前 worktree 的源码 CLI，不需要构建，也不需要全局安装的 Concord。源码模式与安装模式的差别见[从源码运行](architecture.md#从源码运行)。

本机目标平台的[归档](../../feature/cross-platform-release/cli.md#发布资产)只在 worktree 之外构建。打包测试与性能对照使用共享构建缓存，同一份源码在同一台机器上只构建一次；发版流程为每个目标单独构建到自己的临时目录。命令与错误见[构建命令](cli.md)。

## 技术栈

本节约束 Concord 自身的维护代码。

1. 实现、测试和构建脚本采用严格 TypeScript，执行与副作用通过 Effect 组织。不添加手工维护的 JavaScript，不绕过类型检查；编译输出和 JavaScript 消费者兼容 fixture 除外。
2. Effect 依赖精确固定，使用 API 前读取已安装依赖自带的指引。不可信边界严格 Schema 解码并返回具名失败。
3. 归档中的 `bin/concord` 是用 `bun build --compile --bytecode` 为该目标编译的单个可执行文件，内含 Bun 运行时、打包后的应用代码与预编译字节码。工作区服务、计算进程、操作进程等子进程都由这个可执行文件以内部入口启动；`runtime/` 保存 ripgrep 和平台动态库，`bin/concord` 本身不是启动脚本。
4. 唯一原生例外是 `native/hawdb`：Rust N-API 桥接、链接胶水、字节转换、预算执行与固定 revision 的目录所有权锁适配。领域决策、来源核验、测试和构建编排仍属 TypeScript/Effect。
5. 本条约束 Concord 自身。接入项目的语言、包管理器和运行时由其自行选择。

## 验收

没有全局 Concord、没有 `dist/`，只有共享缓存中的原生产物时，以下命令在本仓库正常运行：

```sh
pnpm concord --json --dry-run check
pnpm concord docs check --json
pnpm concord trace show local-sdlc --json
```

`vp build --outDir <临时目录>` 产出的本机目标归档由[打包测试](../testing/README.md#检查入口)解压，并在没有系统 Node.js、Bun 与 pnpm 的 `PATH` 中启动。
