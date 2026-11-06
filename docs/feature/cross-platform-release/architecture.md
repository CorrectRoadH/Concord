# 跨平台标签发布

## 实体所有权

源码标签、应用的包元数据与 GitHub Release 中的归档由 CorrectRoadH/Concord 拥有。CorrectRoadH/homebrew-tap 拥有 Formula、Nix 表达式与 recipe 标签。

运行时协调遵循[可移植协调架构](../portable-coordination/architecture.md)：来源读取不取得租约，提交与恢复使用同一 Node 文件租约。HawDB 是可丢弃缓存。不支持不同锁协议的程序同时协调。

## 数据流

标签工作流从校验后的标签派生版本。原生任务在各自目标系统上构建 HawDB 引擎；一个打包任务只构建一次应用，再为每个目标组装归档，核验版本、原生产物身份与摘要，然后发布源码 Release。

tap 定期或经通知发现更新的公开发布，核验标签、归档与资产身份，生成 Formula 与 Nix 候选。候选分别完成安装和运行检查后才提交并打 recipe 标签，创建同版本渠道完成记录。日常发现、验证与更新不依赖 LLM。

## 不变量

- 普通运行时不探测文件系统名称，不调用外部锁或磁盘工具；支持的协调限于同一主机与 PID 命名空间。
- Darwin 保留路径段的精确拼写，别名不能产生第二个 owner 身份。
- 只有 ESRCH 证明所拥有的 POSIX 进程组已结束。清理不确定时不能产生 green 证据。
- 发布与渠道同步共享精确的候选归档和 SHA-256；自动化成功不表示已完成安装或运行时验收。
- 版本不回退，已有身份不能被不同字节覆盖。
- 应用只使用包内的 Node.js 运行时与 ripgrep，不读取 `PATH` 中的 `node` 或 `rg`。

## 错误

不支持的主机、不可用的文件系统原语、不安全的别名与清理不确定都是具名运行时失败。源码发布失败归源码工作流，Formula 与 Nix 失败归 tap 同步。任何失败都不转换为发布成功的声明。

## 发布产物与渠道

### 归档构成

每个目标一个 `concord-<version>-<target>.tar.gz`，目录结构见 [CLI](cli.md#发布资产)。归档由同一个 TypeScript 打包入口组装，打包测试与发布调用同一入口，摘要只针对最终归档。

| 部分 | 来源 |
| --- | --- |
| `runtime/node` | 仓库[运行时版本](../../engineering/build/README.md#运行时版本)指定的官方 Node.js 二进制，按 nodejs.org 的 `SHASUMS256.txt` 校验后取出 |
| `runtime/rg` | 固定版本的官方 ripgrep 二进制，按 `runtime-deps.json` 记录的 SHA-256 校验 |
| `app/` 中的应用 | 一次构建得到的 JavaScript，与包根布局相同 |
| `app/` 中的依赖 | 按 `pnpm-lock.yaml` 冻结、`--ignore-scripts` 安装的运行依赖；平台相关的可选依赖按目标平台选择 |
| `app/` 中的原生绑定 | 该目标经身份校验的 HawDB N-API 引擎 |
| `bin/concord` | 打包入口生成的 POSIX 启动脚本 |

`bin/concord` 只做定位与转交：解析自身的符号链接，找到归档根，以 `runtime/node` 执行 `app/` 中的应用入口并原样传递参数、标准流与退出码。应用从包根读取版本、资源与原生绑定，并通过包内路径调用 `runtime/rg`。

### 版本与身份

发布版本只从规范标签写入 `app/package.json` 的 `version`。版本、源码标签 commit、各归档的 SHA-256 与 recipe commit 构成发布映射，只有这些身份完全一致时，重跑才能继续中断的阶段。Repository 实现身份包含包内 JavaScript、包元数据、依赖锁与运行时版本。

### Homebrew

Formula 按平台引用对应归档与 SHA-256，没有 `depends_on` 的 node、pnpm 或 ripgrep，也不编译原生引擎。安装把归档内容放入 `libexec`，在 `bin` 链接 `libexec/bin/concord`。

macOS 上 Formula 保留原生字节：HawDB 动态库使用可重定位的 `@rpath` 标识，Formula 声明 `preserve_rpath`。安装时压缩包内全部 Mach-O 文件（原生 addon、`runtime/node` 与 `runtime/rg`），待 Homebrew 链接处理结束后在 post-install 解压还原原始字节，不重签、不改写。

### Nix

Nix 只支持 `x86_64-linux`。表达式用 `fetchurl` 按 Release 中的 SHA-256 取 `linux-x64` 归档，用 `autoPatchelfHook` 修补归档中的 ELF 文件，运行库取自 flake.lock 固定的 nixpkgs。修补只改 ELF 的解释器与运行库路径，不改应用 JavaScript、依赖与启动脚本的逻辑。

### tap 同步

同步入口用受版本管理的 Formula/Nix 模板生成候选，模板与当前发行 recipe 分开。生成前核验标签、资产 SHA-256 与归档内的版本。完整安装与运行由依赖候选的 Homebrew 与 Nix CI job 验证；最终更新 job 同时依赖两者成功，元数据核验不能替代安装成功。

渠道准备不改写当前可安装版本。新资产存在后同步候选，沿用 base SHA 与已有标签比较，原子更新 recipe 与渠道标签。失败保留当前 recipe 和不可变资产，不覆盖既有发布。

## 生命周期

### Owner

Concord 拥有源码校验、归档字节与源码 Release，tap 拥有包管理器元数据与渠道同步。短运行时作用域拥有发布文件租约；runner 作用域另行拥有分离的 POSIX 进程组与持久清理状态。

### 创建

标签事件校验版本并调度默认分支的 Release 工作流，构建 checkout 始终使用显式标签。默认分支拥有跨版本可复用的缓存作用域，源码身份仍由标签拥有。tap 只接受固定的公开仓库、规范标签与唯一匹配的资产。

### 运行

Linux 与 macOS 原生任务分别在 Ubuntu 24.04 与 Apple Silicon macOS 15 上从源码构建 `linux-x64` 与 `darwin-arm64` HawDB 引擎，后者 deployment target 为 macOS 15.0。native manifest 绑定桥接源码、Cargo lock、ABI、HawDB revision 与二进制摘要；本机 Nix 构建的原生产物不进入归档。

一个 Ubuntu 24.04 任务在原生任务之后运行：清理输出目录，构建并类型检查应用一次，收集完整且经核验的原生产物集合，为每个目标组装归档并核验版本与摘要。后续验证解压该归档，不重新构建。同一标签 commit 的完整检查也是源码发布的前置条件。

CI 在四个独立 runner 上分片运行同一完整套件，每个分片串行执行，避免其它测试进程干扰性能计时。手动可移植检查必须断言真实的 HawDB 缓存未命中后命中，只回源不算通过。

### 复用

重试任务可以复用成功的不可变产物；commit、版本或资产摘要变化时不能复用。已有源码资产仅在摘要相同时复用，不覆盖不同字节。tap 版本与摘要一致时不下载归档、不运行平台任务；中断的渠道完成记录可由后续发现修复。

Cargo 缓存按 runner 镜像、原生目标、部署目标、Rust 工具链、lockfile 与 Rust 源码划分。命中缓存仍运行锁定构建并生成当前产物身份，缓存编译不是测试证据。

失败任务最多自动重试一次，复用同一运行中已成功的任务与产物。后续定时发现可以重新尝试未完成的元数据同步；安装失败保留当前 recipe。

### 清理

Repository 租约保留既有的收尾逻辑。所拥有的进程依次收到 TERM、有界宽限期与 KILL；观察不到进程组消失即为清理失败。CI 临时候选归档与配方属于 runner 本地资源，每个任务结束后删除。

### 失败归属

运行时清理失败使命令成功不能作为证据。源码矩阵失败阻止源码 Release。tap 验证失败时源码 Release 的归档仍可由安装脚本安装，但 Homebrew 与 Nix 不更新。
