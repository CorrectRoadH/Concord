# 构建实现

本页声明构建与源码运行的内部机制。命令与错误见[构建命令](cli.md)。

## 类型检查与产物改写

任务命令由 `package.json` 拥有，Bun 运行任务和所有 TypeScript 脚本。上游 Vite 提供 Web 构建和开发服务，tsdown 打包 Herdr mod 与 P5 JavaScript，Oxlint 读取独立配置执行静态规则。构建、门禁、性能测量与 CI 均不调用 Vite+ 或系统 Node；完整归档仍由同一个 TypeScript 组装入口生成。门禁、Web/Herdr/P5 构建与归档组装均须在 Node 不可用的 PATH 下完成。

构建用固定版本的原生 tsc 做完整类型检查。产品代码由固定 Bun 从 TypeScript 源码打包和编译；不通过改写生成 JS 来改变模块加载，也不跳过声明检查。Web 与 Herdr mod 仍由其专用构建入口生成。

`bun run build` 的生产构建钩子准备本机目标的完整归档内容，每次清空输出目录。

## 依赖安装

`bun.lock` 是唯一的依赖锁文件。发版准备通过 Bun 的 JSON5 解析器读取文本锁，并严格校验根工作区的依赖、覆盖项、补丁和受信任依赖；清单、锁或 `.bun-version` 不一致时以 `ReleasePreparationError` 拒绝发版。版本标签只改发布版本，不重新解析依赖。

`package.json` 的 `dependencies` 只列编译程序运行时从 `app/` 按包名加载的外置工具：TypeScript（类型检查与 tsserver 宿主）和 esbuild（p5 与 MDX 编译）。编进 `bin/concord` 的模块（Effect、yaml、Markdown 解析器等）与只用于 Web、Herdr mod 构建的包都属于 `devDependencies`，不进入归档的依赖树。新增运行时按包名加载的依赖时，先改本段。

归档在目标宿主安装生产依赖，验证 esbuild 与 TypeScript 的目标可选包，收集安装树中的许可证，再验证相对符号链接均留在归档内。使用私有复制的安装树，后续 ELF 改写不能污染 Bun 缓存或其它安装。编译、Web、源码服务与归档缓存的输入包含 `bun.lock`；生产依赖缓存还包含 `.bun-version`。

## 编译入口

`src/entry/compiled/main.ts` 是 Bun 编译根，使用 ESM 与 bytecode。归档入口通过字面量惰性 import 选择角色的显式 `run` 函数；导入角色实现不启动进程、不安装 listener，源码薄入口调用同一函数一次。CLI 在 `run` 内捕获 argv、cwd 和环境，完整命令 fallback 使用可静态打包的字面量 import。

`src/base/cache/worker-entry.ts` 作为同次编译的数据库 Worker 入口嵌入可执行文件；编译根固定为 `src`，安装模式从相对编译主入口的 `base/cache/worker-entry.js` 启动。安装后的 Worker 不依赖源码路径或外置 JavaScript 文件；编译产物验收须执行真实数据库查询与关闭。

归档组装在压缩前使用目标可执行文件初始化临时 Git 项目，查询 Memory 与 Issue，并核验持久缓存为 `ready`；每次命令退出均完成 Worker 关闭，失败直接终止组装。

构建从同一源码的正式 CLI 捕获 `--help`、`-h`、`--version` 和 `-v` 的 stdout、stderr 与退出码，作为编译常量嵌入可执行文件。只有完全匹配的参数、非 TTY、`NO_COLOR=1`、`TERM=dumb` 且无 FORCE_COLOR 时使用这些结果；其余调用仍走正式解析器。结果随源码、包版本和编译缓存输入一起失效，不执行外置 startup JavaScript。

内部角色沿用 `workerEntryArgv` 的名称；安装模式参数为 `--concord-internal <name> ...`，选择器只在第一位有效，分派后移除选择器与名称，角色看到的 argv 与源码入口相同。未知角色非零退出。`workspace-server` 使用公开 `server run --root` 命令；`web-build`、Web 构建器和 Herdr mod 的 tsdown 打包器只属于源码工具图，不出现在产品编译图。内部分派不接受任意 JS/TS 路径，不改变进程组、IPC、信号或父进程退出时的资源责任。

编译模式由构建常量 `CONCORD_COMPILED` 选择，不从 cwd、环境或虚拟模块扩展名推断；未定义该常量即源码模式。编译根从真实 executable 定位归档的 `app/`。源码定位依据模块所在 worktree。运行时入口与资源定位不为寻找目录加载完整 Effect。

## 原生绑定复用

Concord 使用 [HawDB 官方发行](https://github.com/nowledge-co/hawdb/releases)的普通 C ABI 动态库与同版本 `@nowledge/hawdb-bun`，不维护 Rust 或 N-API fork。本机开发、测试、CI 与产品发版只下载、验证和使用正式产物，不编译 HawDB 或回退到 Cargo（[用现成的能力](../../taste.md#t-10)）。

`@nowledge/hawdb-bun` 是精确锁定的构建依赖，随 TypeScript 打入 CLI；不增加安装后的外置 npm 依赖。编译同时包含数据库 Worker 入口。运行时只向 `loadHawDB` 传经验证的显式库路径，不自动寻找库，也不读取环境变量选择引擎。

`native-release.json` 使用 `concord.native-release/v2`，固定 `repository: nowledge-co/hawdb`、正式 `version`、`tag: v<version>` 与引擎 `revision`。`assets` 每目标只有一项，包含 Concord `target`、官方 `upstreamTarget`、`name`，以及 `archiveSha256`、`manifestSha256`、`binarySha256`、`headerSha256`、`licenseSha256`。两个目标是 `darwin-arm64` 对应 `aarch64-apple-darwin`，`linux-x64-glibc` 对应 `x86_64-unknown-linux-gnu`；文件名为 `hawdb-ffi-<version>-<upstreamTarget>.tar.gz`。

准备入口先验证共享缓存，未命中时下载固定资产；先核对受信任 pin 中的归档摘要，再解包。拒绝路径穿越、链接、特殊文件、重复及未知成员。官方 `manifest.json` 必须匹配固定摘要、版本、提交、目标、普通 C ABI、特性、宿主要求与全部成员的字节大小和摘要。接受官方 default profile 的 background-maintenance、full-text-search、graph-analytics、tokio-runtime、vector-search，不声称使用最小特性构建。当前产物最低要求为 macOS 11.0 或 glibc 2.34。

缓存为 `${XDG_CACHE_HOME:-~/.cache}/concord/native/<发行标签>/<target>/`，保留官方目录中的 `manifest.json`、`LICENSE`、`include/hawdb_ffi.h` 与 `lib/`。另生成 `artifact.json` 安装收据，字段为 `format: concord.native-artifact/v2`、`target`、`upstreamManifestSha256`、`binarySha256`；后两项分别记录原始官方清单和实际加载库的字节身份。替换映射中的库使用 rename，不原地截断。

`--prebuilt` 验证显式目录；`--require-portable` 验证目标宿主要求。所有测试与发行使用同一份官方库，不提供故障注入绑定或运行时测试开关。缺失、离线、下载失败或身份不符均具名失败；`CONCORD_NATIVE_OFFLINE=1` 禁止下载。普通 TypeScript 修改不改变该二进制依赖。

加载前验证官方清单、头文件、许可证与动态库，核对实际 `dlopen` 文件在验证和加载前后的身份，并核对 `library.version()`。普通 C ABI 随发行版本变化，没有 Concord 自定义桥接 ABI。`verifiedHawdbLibrary(runtime)` 返回经验证的 `binary` 绝对路径、文件 `identity` 与 `version`，资源所有者负责加载、使用及关闭。

源码缓存要求原始官方库摘要；Linux 归档与 Nix 渠道的重定位只在私有副本完成，更新安装收据的 `binarySha256`。官方 `manifest.json` 及其摘要保持不变，保留来源证据；归档携带 `app/native-release.json`，安装运行按该固定来源校验所在安装的最终字节身份。macOS 保留官方已签名的库字节。真实产品验收分别覆盖源码、编译后 Worker 和两个目标平台的加载、资源关闭与锁互操作。

## 归档组装

发版归档由一个 TypeScript 打包入口组装，`bun run build` 与发版工作流都调用它。入口的输入是目标、应用构建输出与经身份校验的原生产物，目标由 [`CONCORD_TARGET`](cli.md#环境变量) 选择。输出为[归档构成](../../feature/cross-platform-release/architecture.md#归档构成)所列的目录与 `concord-<version>-<target>.tar.gz`。

各部分的来源与校验只由归档构成定义，本节只写组装顺序。

1. 构建共享资源与 Web，并严格检查应用类型。
2. 每目标准备干净的运行依赖树：使用固定 Bun、`bun.lock`、`--production --frozen-lockfile --ignore-scripts --linker hoisted --backend copyfile`，按目标选择可选依赖；链接规则由归档构成拥有。
3. 在目标宿主用 `.bun-version` 的 Bun 编译产品入口，关闭自动 dotenv、bunfig 与 tsconfig 加载；Linux 使用 x64 baseline。校验实际 Bun 版本，编译失败不发布缓存。
4. 取得并校验 HawDB、ripgrep、运行库和许可证，复制到私有组装目录。Linux 完成 RPATH 处理与 ELF 依赖检查；macOS 完成最终签名后冻结字节。
5. 写入确定的版本和构建身份，打成最终候选并计算 SHA-256。汇总与发布使用该候选，不重新构建。

下载的上游发行包按 SHA-256 缓存，先校验再使用。归档不携带独立 JS 解释器，不从运行主机 PATH 寻找替代解释器。

## 共享构建缓存

性能对照使用的本机目标归档，按构建输入的摘要保存在 `${XDG_CACHE_HOME:-~/.cache}/concord/build/<摘要>/`。构建输入是 worktree 中参与 `bun run build` 的源码、依赖锁、构建配置、`.bun-version`、`runtime-deps.json` 的内容与原生产物身份，包括未提交的改动。

归档的各部分另按自己的输入缓存，组装只取用这些部分再打包。缓存键包含所有会改变该部分字节或有效性的直接与间接输入，包括产出它的脚本与工具版本，不以文件是否随包发布判断：

| 部分 | 缓存键 |
| --- | --- |
| 编译可执行文件 | 源码、构建配置、依赖锁、TypeScript 与 Bun 版本、目标及 CPU baseline |
| 随应用发布的资源 | `docs`、`skills`、`templates` 等被复制进应用的文件 |
| Web 产物 | 已有的 Web 产物缓存键 |
| 目标的运行依赖安装树 | `bun.lock`、`package.json` 与目标 |
| 运行时文件与许可证 | `.bun-version`、`runtime-deps.json`、目标，以及 Linux `runtime/lib/` 的来源身份 |
| 原生产物 | 自身的身份 |

版本、Git 提交、`bin/concord` 与 Linux 的 RPATH 变换和 ELF 检查在组装时完成：先把各部分从只读缓存复制到私有的组装目录，再做变换，不写回缓存中的部分。macOS 官方 HawDB 动态库与 ripgrep 的已签名字节是部件的输入身份，组装只核验签名，不重签、不改写。新编译的 Concord 可执行文件在目标宿主完成最终签名。最终归档由唯一的组装入口产出；编译、资源构建或组装失败直接使构建命令非零退出。

只改 CLI 源码或文档时只重建对应部分，其余部分命中缓存；这时在参照机门禁负载下，归档准备不超过 60 秒。各部分都未命中（首次构建或清空缓存后）不受这一上限约束，耗时单独报告。各部分的缓存遵守下面同样的发布、并发与清理规则。

1. 使用者先计算摘要。同摘要的目录已发布时直接只读使用，不再构建。
2. 不存在时构建到同一缓存下的临时目录，校验后以原子 rename 发布；同一摘要同时只有一个构建者，其余使用者等待它的结果。构建失败不发布任何目录。
3. 使用中的归档目录不被替换或删除：源码变化得到新摘要和新目录。缓存只保留最近 4 个摘要，删除时跳过仍在使用的目录。
4. 缓存可以随时整体删除，下次使用时重新构建。worktree 中从不出现构建产物。

## 从源码运行

Concord 有两种运行模式：源码模式直接运行 worktree 中的 `.ts`，安装模式运行安装目录中的构建产物。运行模式由一个模块统一判断。

1. **源码约束**：相对导入写 `.ts` 扩展名，只使用可擦除的 TypeScript 语法，类型检查开启 `erasableSyntaxOnly`。Bun 从这些源码入口构建归档可执行文件。
2. **子进程**：源码模式用固定 Bun 运行 `.ts`，关闭 cwd dotenv 与 bunfig。安装模式通过同一 `bin/concord` 的内部角色分派启动。
3. **编译缓存**：源码执行使用 Bun 自身加载机制；安装模式使用随可执行文件生成的 bytecode，不设置 Node/V8 编译缓存。
4. **原生库**：源码运行取自经身份校验的本机共享缓存，构建产物取自安装目录根，两者的校验规则相同；源码与安装模式都经同一数据库 Worker 入口加载。
5. **安装身份**：源码模式的安装身份是 worktree 位置，安装模式使用产物摘要。
6. **服务复用**：源码模式与安装模式一样，协议相同就复用正在运行的服务，不因源码改变而重启，见[启动与裁决](../../feature/local-data-engine/architecture.md#启动与裁决)。改了服务端代码后要看到新行为，先运行 `bun run concord server stop`。
7. **缓存身份**：缓存身份包含源码摘要，源码变化后不复用旧缓存。
8. **Web 资源**：源码模式读取按 `web/` 的构建输入摘要共享的 Web 产物 `${XDG_CACHE_HOME:-~/.cache}/concord/web/<摘要>/`。缺失时由一个进程构建并原子发布，其余进程等待；服务本身不编译 Web，只改 CLI 或服务代码时也不重新构建 Web。安装模式读取安装目录内的编译结果。日常改前端用 `bun run dev`。

## 脚本只写项目特有的规则

`scripts/` 只承担 Vite、tsdown、Oxlint、Effect、Bun 与测试工具没有提供的规则（[用现成的能力，不重写](../../taste.md#t-10)）。

| 需要 | 使用 | 脚本只负责 |
| --- | --- | --- |
| 测试发现、并行、分片、执行与报告 | 官方 `bun test`、JUnit 与 timings | 文档变更时扩大选择、完成性校验与整次调用的资源回收；见[测试引擎](../testing/architecture.md#bun-测试引擎) |
| 业务操作的基准测量 | Mitata | 真实场景、Fixture 与预算关联；不实现采样器、统计或 reporter |
| 静态检查与任务编排 | `bun run`、tsc 与 Oxlint | 一个检查失败时其余检查继续运行并汇总结果 |
| 子进程、文件、临时目录与超时 | Effect 的 ChildProcess、FileSystem、Scope 与 Duration | 进程组回收的确认 |
| JS 打包 | `tsdown` | native 产物的身份校验与归档组装 |

没有调用者的脚本直接删除。性能测量脚本的计时与采样见[性能测量实现](../performance/architecture.md)。

编译程序启用 package.json 的 exports/入口解析，以加载锚定于安装 app/package.json 的固定工具及显式选择的项目测试框架；不把调用者 cwd 当作 Concord 依赖解析根。dotenv、bunfig preload 与 tsconfig 自动加载仍关闭。项目框架仅在显式原生收集的边界加载，包元数据存在本身不执行脚本。
