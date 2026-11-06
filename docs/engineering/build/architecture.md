# 构建实现

本页声明构建与源码运行的内部机制。命令与错误见[构建命令](cli.md)。

## 类型检查与产物改写

构建用固定版本的原生 tsc 做完整类型检查，并输出声明与 sourcemap，构建与运行时使用同一编译器版本。

为保持启动性能，构建只改写生成的 JS：把 Effect namespace import 改为窄化导入，每处替换保持原换行数。sourcemap 先解码为绝对坐标，删除被改写行的映射后重新编码，保留其余映射。不改写源文件，不跳过声明检查。

`vp build` 的生产构建钩子准备本机目标的完整归档内容，每次清空输出目录。

## 原生绑定复用

原生产物按以下顺序取得，第一项命中即停止。每一项都经 `--prebuilt` 的身份校验：target、ABI、HawDB revision、源码摘要、锁文件摘要、二进制与许可证摘要全部一致才使用。

1. 本机共享缓存 `${XDG_CACHE_HOME:-~/.cache}/concord/native/<源码摘要>-<锁文件摘要>/<target>/`，同一台机器的所有 checkout 与 worktree 共用。
2. 本仓库 GitHub Release `native-<源码摘要前 16 位>` 中的 `concord-native-<target>.tar.gz`。下载后校验，写入共享缓存。
3. 用固定 Rust 工具链编译，结果写入共享缓存。

发版流程不使用前两项，始终从源码编译要发版的原生产物。按摘要的 Release 由手动触发的 `native` workflow 为每个 target 编译并上传；本地构建与 CI 只读取它。

### 故障注入产物

验证事务失败与崩溃恢复的测试需要带测试钩子的原生产物。`node scripts/build-native.ts --test-hooks` 从源码编译它，产物身份记录 `testHooks: true`，只写入调用方用 `XDG_CACHE_HOME` 指定的私有缓存；它不参与上面的复用顺序，不能复用、下载或打包进归档。

源码模式加载原生产物时，`CONCORD_NATIVE_TEST_HOOKS=1` 表示要求带钩子的产物，省略表示要求不带钩子的产物；产物的 `testHooks` 与要求不一致时返回 `HawdbIncompatible`。其余身份项照常全部校验。安装包始终拒绝带钩子的产物。

## 归档组装

发版归档由一个 TypeScript 打包入口组装，`vp build`、打包测试与发版工作流都调用它。入口的输入是目标、应用构建输出与经身份校验的原生产物，输出为[归档构成](../../feature/cross-platform-release/architecture.md#归档构成)所列的目录与 `concord-<version>-<target>.tar.gz`。各部分的来源与校验只由归档构成定义，本节只写组装顺序。目标由 [`CONCORD_TARGET`](cli.md#环境变量) 选择。

1. 应用 JavaScript、声明与 Web 产物只依赖与目标无关的输入，按这些输入构建一次，各目标共用；切换 `CONCORD_TARGET` 不重新构建应用。
2. 每个目标用独立、干净的安装树装运行依赖：按 `pnpm-lock.yaml` 冻结、`--ignore-scripts`，保留可选依赖，用 pnpm 的 `--os`、`--cpu` 与 `--libc` 选择目标平台的包（`linux-x64` 为 glibc）。安装树中的符号链接不得指向归档之外。依赖必须在目标平台执行安装脚本或编译时组装失败，不静默漏包。
3. 按归档构成取得并校验 `runtime/node`、`runtime/rg`、Linux 的 `runtime/lib/` 与许可证文本。
4. Linux 目标按 [Linux 运行库](../../feature/cross-platform-release/architecture.md#linux-运行库)设置 RPATH 并检查全部 ELF，不满足即失败。macOS 目标的 HawDB 绑定与 `rg` 使用原生任务签名后的字节，不改写。
5. 生成 `bin/concord`，写入版本，打成归档并计算 SHA-256。发版时打包任务另打出[库包](../../feature/cross-platform-release/architecture.md#库包)。

下载的上游发行包按文件内容的 SHA-256 缓存在 `${XDG_CACHE_HOME:-~/.cache}/concord/runtime/`，先校验再使用，校验失败不进入缓存或归档。入口不读取 `PATH` 中的 `node` 或 `rg`。

## 共享构建缓存

打包测试与性能对照使用的本机目标归档按构建输入的摘要保存在 `${XDG_CACHE_HOME:-~/.cache}/concord/build/<摘要>/`。构建输入是工作区中参与 `vp build` 的源码、依赖锁、构建配置、`.node-version`、`runtime-deps.json` 的内容与原生产物身份，包括未提交的改动。

1. 使用者先计算摘要。同摘要的目录已发布时直接只读使用，不再构建。
2. 不存在时构建到同一缓存下的临时目录，校验后以原子 rename 发布；同一摘要同时只有一个构建者，其余使用者等待它的结果。构建失败不发布任何目录。
3. 使用中的归档目录不被替换或删除：源码变化得到新摘要和新目录。缓存只保留最近 4 个摘要，删除时跳过仍在使用的目录。
4. 缓存可以随时整体删除，下次使用时重新构建。检出中从不出现构建产物。

## 从源码运行

| 方面 | 规则 |
| --- | --- |
| 原生绑定 | 源码运行取自经身份校验的本机共享缓存，构建产物取自包根，校验规则相同 |
| 源码约束 | 相对导入写 `.ts` 扩展名；只使用可擦除的 TypeScript 语法，类型检查开启 `erasableSyntaxOnly`；构建安装包时由 TypeScript 的 `rewriteRelativeImportExtensions` 改写为 `.js` |
| 子进程 | 运行模式由一个模块统一判断。源码模式用 Node 自带的类型擦除直接运行 `.ts` 入口，不经转译工具；V8 编译缓存放在 `${XDG_CACHE_HOME:-~/.cache}/concord/node-compile/`，按文件复用，改一个文件只重新编译这个文件。安装包模式用包内的 `runtime/node` 启动包内的 JavaScript 入口 |
| 安装身份 | 源码模式的安装身份是检出位置，安装包模式使用产物摘要。源码模式的服务记录启动时的源码摘要 |
| 服务替换 | 同一检出的调用发现运行中服务的源码摘要与当前不同时，先停止它并等待完全退出，再启动新服务，不报 `WorkspaceServerVersionConflict` |
| 缓存身份 | 缓存身份包含源码摘要，源码变化后不复用旧缓存 |
| Web 资源 | 源码模式读取按 `web/` 的构建输入摘要共享的 Web 产物 `${XDG_CACHE_HOME:-~/.cache}/concord/web/<摘要>/`；缺失时由一个进程构建并原子发布，其余等待，服务本身不编译 Web。只改 CLI 或服务代码时不重新构建 Web。日常改前端用 `vp dev`。安装包模式读取包内的编译结果 |

## 脚本只写项目特有的规则

`scripts/` 只承担 Vite+、Effect、Node 与测试工具没有提供的规则（[用现成的能力，不重写](../../taste.md#t-10)）。

| 需要 | 使用 | 脚本只负责 |
| --- | --- | --- |
| Node 测试的发现、文件并发、分片与 reporter | Node 官方 test runner：`--test-concurrency`、`--test-shard`、`--test-reporter` 与 `run()` | 源码 loader、每文件日志与耗时、按路径分流到浏览器测试 |
| 浏览器测试的 worker 与分片 | e2e 工具自带的 worker、分片与 reporter | 与 Node 测试的结果汇总 |
| 静态检查与任务编排 | `vp run` 任务 | 一个检查失败时其余检查继续运行并汇总结果 |
| 子进程、文件、临时目录与超时 | Effect 的 ChildProcess、FileSystem、Scope 与 Duration | 进程组回收的确认 |
| JS 打包 | `vp pack` | native 产物的身份校验与归档组装 |

没有调用者的脚本直接删除。性能测量脚本的计时与采样见[性能测量实现](../performance/architecture.md)。
