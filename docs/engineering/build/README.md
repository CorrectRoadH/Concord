# 构建与开发环境

维护者用本主题准备开发环境、从源码运行 Concord，并把完整安装包构建到检出之外。检查入口与测试见[测试](../testing/README.md)，性能测量见[性能测量](../performance/README.md)。

## 开始开发

开发需要[运行时版本](#运行时版本)指定的 Node.js、pnpm 11.18.0、Git、Rust 1.97.1 和本机 C 链接工具链。

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

开发、CI 与发布归档使用同一个 Node.js 26 LTS 精确版本，唯一记录在仓库根目录的 `.node-version` 中。版本管理工具与 CI 的 Node 安装都读取这个文件，发布构建按它下载归档内的 `runtime/node`；`package.json` 不声明 `engines`。

产品代码可以使用该版本的全部 API，例如 `Temporal`。升级运行时只改 `.node-version`，交付前跑完整门禁与打包测试。

## 怎样工作

开发检出中没有 `dist/`：日常开发运行源码，测试同样运行源码，Web 产物与原生绑定来自检出外按输入摘要共享的缓存。检出只有源码这一个安装身份，CLI 与工作区服务不会因新旧产物并存而冲突。

`pnpm concord <参数>` 直接运行当前检出的源码 CLI，不需要构建，也不需要全局安装的 Concord。源码模式与安装包模式的差别见[从源码运行](architecture.md#从源码运行)。

安装包是本机目标的[发布归档](../../feature/cross-platform-release/cli.md#发布资产)，只在检出之外构建。打包测试与性能对照使用共享构建缓存，同一份源码在同一台机器上只构建一次；发布流程为每个目标单独构建到自己的临时目录。命令与错误见[构建命令](cli.md)。

## 技术栈

本节约束 Concord 自身的维护代码。

1. 实现、测试和构建脚本采用严格 TypeScript，执行与副作用通过 Effect 组织。不添加手工维护的 JavaScript，不绕过类型检查；编译输出和 JavaScript 消费者兼容 fixture 除外。
2. Effect 依赖精确固定，使用 API 前读取安装包指引。不可信边界严格 Schema 解码并返回具名失败。
3. 归档的启动脚本 `bin/concord` 由 TypeScript 打包入口生成，不作为手工维护的 shell 脚本进入检出。
4. 唯一原生例外是 `native/hawdb`：Rust N-API 桥接、链接胶水、字节转换、预算执行与固定 revision 的目录所有权锁适配。领域决策、来源核验、测试和构建编排仍属 TypeScript/Effect。
5. 本条约束 Concord 自身。接入项目的语言、包管理器和运行时由其自行选择。

## 验收

没有全局 Concord、没有 `dist/`，只有共享缓存中的原生产物时，以下命令在本仓库正常运行：

```sh
pnpm concord --json --dry-run check
pnpm concord docs check --json
pnpm concord trace show local-sdlc --json
```

`vp build --outDir <临时目录>` 产出的本机目标归档由[打包测试](../testing/README.md#检查入口)解压，并在没有系统 Node.js 的 `PATH` 中启动。
