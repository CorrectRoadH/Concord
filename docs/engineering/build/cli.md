# 构建命令

项目使用固定版本的 Vite+ 管理任务，依赖安装由 `vp install` 委托固定版本的 pnpm。未全局安装时以 `pnpm exec vp` 调用。

| 命令 | 作用 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 首次安装依赖与项目固定版本的 `vp` |
| `vp install` | 之后的依赖安装 |
| `pnpm concord <参数>` | 运行当前 worktree 的源码 CLI，等价于 `node src/entry/cli/entry.ts`（[从源码运行](architecture.md#从源码运行)） |
| `vp build --outDir <目录>` | 把 `CONCORD_TARGET` 选择的目标的完整归档构建到 worktree 之外的目录 |
| `vp run build:native` | 准备原生绑定，按[原生绑定复用](architecture.md#原生绑定复用)的顺序取得 |
| `vp dev` | 只启动 Web 开发服务器，不运行发行准备 |

完整归档包含启动脚本、Node.js 运行时、ripgrep、CLI、原生绑定、Web、PR 预览与随包资源。

原生绑定只有在 `native/hawdb` 或其锁文件变化时才需要重建。`build:native` 遇到下载失败、产物缺失或校验不一致时，进入下一项来源并输出原因，不中断构建。

`pnpm gate` 是检查入口，不是构建命令，见[检查入口](../testing/README.md#检查入口)。Vite+ 内置的 `vp check` 和 `vp test` 不调用本项目脚本。任务结果不缓存。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `CONCORD_NATIVE_OFFLINE=1` | `build:native` 跳过下载，只用共享缓存或从源码编译 |
| `XDG_CACHE_HOME` | 原生产物共享缓存的根目录，省略时为 `~/.cache` |
| `CONCORD_NATIVE_TEST_HOOKS=1` | 源码模式只加载带测试钩子的原生产物（[故障注入产物](architecture.md#故障注入产物)） |
| `CONCORD_TARGET` | `vp build` 组装的目标：`linux-x64` 或 `darwin-arm64`，省略时取本机目标 |

## 错误

| 错误 | 条件 |
| --- | --- |
| `BuildOutputInCheckout` | `vp build --outDir` 的目录位于 worktree 内 |
| `DistInCheckout` | 门禁开始时 worktree 中存在 `dist/`；删除它后重试 |
| `UnsupportedTarget` | `CONCORD_TARGET` 不是 `linux-x64` 或 `darwin-arm64`，或省略它时本机不是这两者之一 |
| `HawdbUnavailable` | 源码运行找不到经身份校验的原生绑定；提示运行 `pnpm exec vp run build:native` |

`UnsupportedTarget` 不写输出目录，以非零退出，消息列出支持的目标。

定义了自己错误码的命令按那些错误码包装原生绑定缺失，以 `HawdbUnavailable` 为原因码。例如工作区投影返回 `WorkspaceProjectionUnavailable`，`details.reason` 为 `HawdbUnavailable`。

在 Ubuntu 上为 Apple Silicon macOS 组装归档：

```sh
CONCORD_TARGET=darwin-arm64 vp build --outDir /tmp/concord-darwin-arm64
```

该目标的原生产物取自共享缓存或按摘要的 Release，发版流程传入原生任务的产物；Ubuntu 上不编译 macOS 原生绑定。
