# 构建实现

本页声明构建与源码运行的内部机制。命令与错误见[构建命令](cli.md)。

## 类型检查与产物改写

构建用固定版本的原生 tsc 做完整类型检查，并输出声明与 sourcemap，构建与运行时使用同一编译器版本。

为保持启动性能，构建只改写生成的 JS：把 Effect namespace import 改为窄化导入，每处替换保持原换行数。sourcemap 先解码为绝对坐标，删除被改写行的映射后重新编码，保留其余映射。不改写源文件，不跳过声明检查。

`vp build` 的生产构建钩子准备完整发行产物，每次清空输出目录。

## 原生绑定复用

原生产物按以下顺序取得，第一项命中即停止。每一项都经 `--prebuilt` 的身份校验：target、ABI、HawDB revision、源码摘要、锁文件摘要、二进制与许可证摘要全部一致才使用。

1. 本机共享缓存 `${XDG_CACHE_HOME:-~/.cache}/concord/native/<源码摘要>-<锁文件摘要>/<target>/`，同一台机器的所有 checkout 与 worktree 共用。
2. 本仓库 GitHub Release `native-<源码摘要前 16 位>` 中的 `concord-native-<target>.tar.gz`。下载后校验，写入共享缓存。
3. 用固定 Rust 工具链编译，结果写入共享缓存。

发布流程不使用前两项，始终从源码编译要发布的原生产物。按摘要的 Release 由手动触发的 `native` workflow 为每个 target 编译并发布；本地构建与 CI 只读取它。

## 从源码运行

| 方面 | 规则 |
| --- | --- |
| 原生绑定 | 源码运行取自经身份校验的本机共享缓存，构建产物取自包根，校验规则相同 |
| 子进程 | 运行模式由一个模块统一判断。源码模式下，查询、扫描与编辑器子进程使用同一 loader 启动对应的 `.ts` 入口；安装包模式启动包内的 JavaScript 入口 |
| 安装身份 | 源码模式的安装身份是检出位置，安装包模式使用产物摘要。源码模式的服务记录启动时的源码摘要 |
| 服务替换 | 同一检出的调用发现运行中服务的源码摘要与当前不同时，先停止它并等待完全退出，再启动新服务，不报 `WorkspaceServerVersionConflict` |
| 缓存身份 | 缓存身份包含源码摘要，源码变化后不复用旧缓存 |
| Web 资源 | 源码模式下，工作区服务通过 Vite 从 `web/` 源码即时编译 Web 工作台与 PR 预览；安装包模式读取包内的编译结果 |

## 脚本只写项目特有的规则

`scripts/` 只承担 Vite+、Effect、Node 与测试工具没有提供的规则（[用现成的能力，不重写](../../taste.md#t-10)）。

| 需要 | 使用 | 脚本只负责 |
| --- | --- | --- |
| Node 测试的发现、文件并发、分片与 reporter | Node 官方 test runner：`--test-concurrency`、`--test-shard`、`--test-reporter` 与 `run()` | 源码 loader、每文件日志与耗时、按路径分流到浏览器测试 |
| 浏览器测试的 worker 与分片 | e2e 工具自带的 worker、分片与 reporter | 与 Node 测试的结果汇总 |
| 静态检查与任务编排 | `vp run` 任务 | 一个检查失败时其余检查继续运行并汇总结果 |
| 子进程、文件、临时目录与超时 | Effect 的 ChildProcess、FileSystem、Scope 与 Duration | 进程组回收的确认 |
| JS 打包 | `vp pack` | native 产物的身份校验与安装包组装 |

没有调用者的脚本直接删除。性能测量脚本的计时与采样见[性能测量实现](../performance/architecture.md)。
