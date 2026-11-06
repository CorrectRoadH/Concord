# 构建命令

项目使用固定版本的 Vite+ 管理任务，依赖安装由 `vp install` 委托固定版本的 pnpm。未全局安装时以 `pnpm exec vp` 调用。

| 命令 | 作用 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 首次安装依赖与项目固定版本的 `vp` |
| `vp install` | 之后的依赖安装 |
| `pnpm concord <参数>` | 运行当前检出的源码 CLI，等价于 `node --import tsx src/entry/cli/entry.ts` |
| `vp build --outDir <目录>` | 把完整安装包（原生绑定、CLI、Web、PR 预览与随包资源）构建到检出之外的目录 |
| `vp run build:native` | 准备原生绑定，按[原生绑定复用](architecture.md#原生绑定复用)的顺序取得 |
| `vp dev` | 只启动 Web 开发服务器，不运行发行准备 |

`pnpm gate` 是检查入口，不是构建命令，见[检查入口](../testing/README.md#检查入口)。Vite+ 内置的 `vp check` 和 `vp test` 不调用本项目脚本。任务结果不缓存。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `CONCORD_NATIVE_OFFLINE=1` | `build:native` 跳过下载，只用共享缓存或从源码编译 |
| `XDG_CACHE_HOME` | 原生产物共享缓存的根目录，省略时为 `~/.cache` |

## 错误

| 错误 | 条件 |
| --- | --- |
| `BuildOutputInCheckout` | `vp build --outDir` 的目录位于检出内 |
| `DistInCheckout` | 门禁开始时检出中存在 `dist/`；删除它后重试 |
| `HawdbUnavailable` | 源码运行找不到经身份校验的原生绑定；提示运行 `pnpm exec vp run build:native` |

定义了自己错误码的命令按那些错误码包装原生绑定缺失，以 `HawdbUnavailable` 为原因码。例如工作区投影返回 `WorkspaceProjectionUnavailable`，`details.reason` 为 `HawdbUnavailable`。

原生绑定只有在 `native/hawdb` 或其锁文件变化时才需要重建。下载失败、产物缺失或校验不一致时进入下一项来源并输出原因，不中断构建。
