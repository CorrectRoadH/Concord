# 构建与开发环境

维护者用本文档包准备开发环境、从源码运行 Concord，并把完整[归档](../../concepts.md#archive)构建到 worktree 之外。检查入口与测试见[测试](../testing/README.md)，性能测量见[性能测量](../performance/README.md)。

## 开始开发

开发需要[运行时版本](#运行时版本)指定的 Bun 和 Git。

```sh
git clone https://github.com/CorrectRoadH/Concord.git
cd Concord
bun install --frozen-lockfile
bun run build:native # 下载并校验固定版本的 HawDB 二进制
bun run concord --help
bun run test
```

交付另行执行[检查入口](../testing/README.md#检查入口)中的类型检查、lint 与自举检查；性能受影响时独立运行 benchmark。

任务运行使用 `bun run`；Vite、tsdown 与 Oxlint 使用项目锁定的本地版本，并由 Bun 执行。依赖通过 `bun install` 管理。

依赖清单由 `package.json` 拥有，精确解析结果只保存在 `bun.lock`；`packageManager` 中的 Bun 版本必须与 `.bun-version` 相同。`overrides`、`patchedDependencies` 与 `trustedDependencies` 同样由 `package.json` 拥有。安装使用 Bun 的 hoisted 布局；CI 与归档安装冻结锁文件并禁用依赖生命周期脚本。开发工具通过 `bun run --no-install <工具>` 调用本地版本，缺失时失败，不临时下载另一个版本（[一件事只写一次](../../taste.md#t-3)）。

参与开发前请阅读[开发规则](../../../AGENTS.md)与[项目品味](../../taste.md)。

## 运行时版本

Concord 运行在 Bun 上。开发、测试、CI 与发版归档使用同一个 Bun 精确版本，唯一记录在仓库根目录的 `.bun-version` 中；`package.json` 不声明 `engines`。性能测量默认直接调用业务操作，启动成本按需要单独分析，不能用空操作代替业务测量（[快到每次都愿意跑](../../taste.md#t-7)）。

产品代码可以使用该版本 Bun 的 API，以及它实现的 Node.js 兼容 API。开发工具与测试控制器也运行在 Bun 上，不要求安装 Node.js。`node:` 导入与 `@types/node` 声明只使用 Bun 提供的兼容 API。Vitest 开发依赖仅提供产品 adapter 的上游 API 类型；运行时从消费项目加载，不在门禁执行 Vitest。升级产品运行时更新 `.bun-version`，交付前跑完整门禁与归档构建。

只交付 Herdr mod 时运行 `bun run build:herdr`，生成目录直接随 Git 提交分发，不需要完整归档或 CLI Release，见[独立交付 Concord mod](use-case/share-herdr-mod.md)。

## 怎样工作

开发用的 worktree 中没有 `dist/`：日常开发运行源码，测试同样运行源码，Web 产物与原生绑定来自 worktree 外按输入摘要共享的缓存。CLI 与工作区服务不会因新旧产物并存而冲突。

`bun run concord <参数>` 直接运行当前 worktree 的源码 CLI，不需要构建，也不需要全局安装的 Concord。源码模式与安装模式的差别见[从源码运行](architecture.md#从源码运行)。

本机目标平台的[归档](../../feature/cross-platform-release/cli.md#发布资产)只在 worktree 之外构建。性能对照使用共享构建缓存，同一份源码在同一台机器上只构建一次；发版流程为每个目标单独构建到自己的临时目录。命令与错误见[构建命令](cli.md)。

## 技术栈

本节约束 Concord 自身的维护代码。

1. 实现、测试和构建脚本采用严格 TypeScript，执行与副作用通过 Effect 组织。不添加手工维护的 JavaScript，不绕过类型检查；编译输出和 JavaScript 消费者兼容 fixture 除外。
2. Effect 依赖精确固定，使用 API 前读取已安装依赖自带的指引。不可信边界严格 Schema 解码并返回具名失败。
3. 归档中的 `bin/concord` 是用 `bun build --compile --bytecode` 为该目标编译的单个可执行文件，内含 Bun 运行时、打包后的应用代码与预编译字节码。工作区服务、计算进程、操作进程等子进程都由这个可执行文件以内部入口启动；`runtime/` 保存 ripgrep 和平台动态库，`bin/concord` 本身不是启动脚本。
4. 本仓库不包含 Rust 或 HawDB 编译。原生桥接由 HawDB fork 构建并按上游版本发布；Concord 只下载、校验和使用二进制。领域决策、来源核验、测试和构建编排使用 TypeScript/Effect。
5. 本条约束 Concord 自身。接入项目的语言、包管理器和运行时由其自行选择。

## 验收

没有全局 Concord、没有 `dist/`，只有共享缓存中的原生产物时，以下命令在本仓库正常运行：

```sh
bun run concord --json --dry-run check
bun run concord docs check --json
bun run concord trace show local-sdlc --json
```

`bun run build --outDir <临时目录>` 构建本机目标的完整归档；编译或组装失败由命令直接报错。CI 在两个目标宿主执行同一[归档构建](../testing/README.md#归档构建)。
