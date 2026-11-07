# 构建命令

任务使用 `bun run`，依赖使用固定版本的 Bun 安装；Vite、tsdown 与 Oxlint 由 Bun 执行。

| 命令 | 作用 |
| --- | --- |
| `bun install --frozen-lockfile` | 首次安装依赖与固定版本的本地工具 |
| `bun install` | 之后的依赖安装 |
| `bun run concord <参数>` | 运行当前 worktree 的源码 CLI，等价于 `bun --no-env-file --config=/dev/null src/entry/cli/entry.ts`（[从源码运行](architecture.md#从源码运行)） |
| `bun run build --outDir <目录>` | 把 `CONCORD_TARGET` 选择的目标的完整归档构建到 worktree 之外的目录 |
| `bun run build:native` | 准备原生绑定，按[原生绑定复用](architecture.md#原生绑定复用)的顺序取得 |
| `bun run build:herdr` | 只构建并更新仓库的 `concord/`，见[独立交付 mod](use-case/share-herdr-mod.md)；成功退出 0，校验或构建失败非零退出并输出具名失败，不执行 Git 或创建 Release |
| `bun run dev` | 只启动 Web 开发服务器，不运行发行准备 |

完整归档包含内含 Bun 与应用字节码的可执行文件、ripgrep、原生绑定、Web、PR 预览与随包资源。

原生绑定只在 `native-release.json` 固定版本升级时更新。`build:native` 下载并校验本机的生产与测试绑定；遇到缺包、下载失败或校验不一致时非零退出，绝不调用编译器。

`bun run gate` 是检查入口，不是构建命令，见[检查入口](../testing/README.md#检查入口)。任务结果不缓存。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `CONCORD_NATIVE_OFFLINE=1` | 准备绑定时跳过下载，只用已经验证的共享缓存；未命中则失败 |
| `XDG_CACHE_HOME` | 原生产物共享缓存的根目录，省略时为 `~/.cache` |
| `CONCORD_NATIVE_TEST_HOOKS=1` | 源码模式只加载带测试钩子的原生产物（[故障注入产物](architecture.md#故障注入产物)） |
| `CONCORD_TARGET` | `bun run build` 组装的目标：`linux-x64` 或 `darwin-arm64`，省略时取本机目标 |

## 错误

| 错误 | 条件 |
| --- | --- |
| `BuildOutputInCheckout` | `bun run build --outDir` 的目录位于 worktree 内 |
| `DistInCheckout` | 门禁开始时 worktree 中存在 `dist/`；删除它后重试 |
| `HerdrModBuildFailed` | `bun run build:herdr` 的版本、构建或分发文件校验失败；错误消息包含原因，校验完成前不替换现有 `concord/` |
| `UnsupportedTarget` | `CONCORD_TARGET` 不是 `linux-x64` 或 `darwin-arm64`，或省略它时本机不是这两者之一 |
| `NativePreparationFailed` | 固定版本的二进制缺失、下载或校验失败，或者离线且缓存不可用；不调用编译器 |
| `HawdbUnavailable` | 源码运行找不到经身份校验的原生绑定；提示运行 `bun run build:native` |

`UnsupportedTarget` 不写输出目录，以非零退出，消息列出支持的目标。

定义了自己错误码的命令按那些错误码包装原生绑定缺失，以 `HawdbUnavailable` 为原因码。例如工作区投影返回 `WorkspaceProjectionUnavailable`，`details.reason` 为 `HawdbUnavailable`。

在 Ubuntu 上为 Apple Silicon macOS 组装归档：

```sh
CONCORD_TARGET=darwin-arm64 bun run build --outDir /tmp/concord-darwin-arm64
```

该目标的原生产物取自共享缓存或固定版本的 Release，发版流程传入原生任务的产物；Ubuntu 上不编译 macOS 原生绑定。
