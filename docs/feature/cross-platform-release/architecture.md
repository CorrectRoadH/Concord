# 跨平台标签发版

## 实体所有权

源码标签、应用的包元数据、GitHub Release 中的归档与安装脚本由 CorrectRoadH/Concord 拥有。CorrectRoadH/homebrew-tap 拥有 Formula、Nix 表达式、recipe 标签，以及 Nix 渠道修补后的安装身份。

运行时协调遵循[可移植协调架构](../portable-coordination/architecture.md)：来源读取不取得租约，提交与恢复使用同一文件租约。HawDB 是可丢弃缓存。不支持不同锁协议的程序同时协调。

## 数据流

标签工作流从校验后的标签派生版本。原生任务在各自目标系统上下载并校验固定发行的 HawDB 二进制；各目标宿主按同一 commit 构建 Bun 可执行文件并组装候选归档，核验版本、原生产物身份与摘要。验证任务在目标系统上运行同一份候选，全部通过后创建源码 Release。

tap 定期或经通知发现新的公开发版，核验标签、归档与资产身份，生成 Formula 与 Nix 候选。候选分别完成安装和运行检查后才提交并打 recipe 标签，创建同版本渠道完成记录。日常发现、验证与更新不依赖 LLM。

## 不变量

- 普通运行时不探测文件系统名称，不调用外部锁或磁盘工具；支持的协调限于同一主机与 PID 命名空间。
- Darwin 保留路径段的精确拼写，别名不能产生第二个 owner 身份。
- 只有 ESRCH 证明所拥有的 POSIX 进程组已结束。清理不确定时不能产生 green 证据。
- 发版与渠道同步共享精确的候选归档和 SHA-256；发版的字节就是验证过的候选。自动化成功不表示已完成渠道安装后的验收。
- 版本不回退，已有身份不能被不同字节覆盖。
- 应用使用 `bin/concord` 内嵌的 Bun 运行时与归档内 ripgrep，不读取 `PATH` 中的 `node`、`bun` 或 `rg`；Linux 上的动态库解析不依赖 `LD_LIBRARY_PATH`。

## 错误

不支持的主机、不可用的文件系统原语、不安全的别名与清理不确定都是具名运行时失败。源码发版失败归源码工作流，Formula 与 Nix 失败归 tap 同步。任何失败都不转换为发版成功的声明。

## 发版产物与渠道 {#发布产物与渠道}

### 归档构成

每个目标一个 `concord-<version>-<target>.tar.gz`，目录结构见 [CLI](cli.md#发布资产)。归档由同一个 TypeScript 打包入口组装，步骤见[归档组装](../../engineering/build/architecture.md#归档组装)；本地构建与发版调用同一入口，摘要只针对最终归档。本表是各部分来源与校验的唯一定义。

| 部分 | 来源 |
| --- | --- |
| `runtime/rg` | 仓库根目录的 `runtime-deps.json` 唯一记录 ripgrep 版本与每个目标的官方发行资产（文件名与 SHA-256），按它校验后取出 `rg` 与许可证；Linux 使用官方静态链接的 musl 版本，不设 RPATH；macOS 的 `rg` 由 macOS 原生任务校验、ad-hoc 签名后随原生产物交给组装，签名后的摘要记在该任务的产物清单 |
| `runtime/lib/` | 仅 Linux：Ubuntu 24.04 构建环境中的 `libatomic.so.1` 与 `libstdc++.so.6`，以及检查发现的其它 glibc 之外的 `DT_NEEDED` 库 |
| `app/` 中的资源 | 包元数据、锁文件、docs、skills、templates、Web、预览、p5 类型与 Herdr mod；不保留应用模块 JS 作为另一套执行入口 |
| `app/` 中的依赖 | 按 `pnpm-lock.yaml` 冻结、`--ignore-scripts` 安装的运行依赖；平台相关的可选依赖按目标平台选择 |
| `app/` 中的原生绑定 | 该目标经身份校验的 HawDB N-API 引擎 |
| `licenses/` | 固定 Bun 发行版及其内嵌组件、ripgrep、`runtime/lib/` 中的运行库与运行依赖的许可证文本 |
| `bin/concord` | 固定 Bun 以 `--compile --bytecode --format=esm` 生成的目标原生可执行文件，包含应用与固定角色入口 |

`bin/concord` 从真实可执行文件位置解析归档根，支持符号链接与含空格路径。应用从 `app/` 读取版本、资源和经校验的原生绑定；只能从该目录解析外置工具依赖，不能命中消费者 cwd 的同名包。内部角色由同一可执行文件分派，见[编译入口](../../engineering/build/architecture.md#编译入口)。

目标编译与组装在目标宿主完成：Ubuntu 24.04 使用 `bun-linux-x64-baseline`，macOS arm64 使用 `bun-darwin-arm64`。bytecode 不在不同宿主之间复用。所有目标绑定同一标签 commit/version 与 `.bun-version`；目标、实际 Bun 版本、CPU 配置和构建输入共同参与编译缓存身份。候选任务先完成字节变换和签名再压缩；汇总任务只验证并收集候选、生成 SHA256SUMS，不重编译候选。

依赖树允许内部相对 symlink，链接目标必须仍在安装树内且不能形成环；外部链接、绝对链接与特殊文件被拒绝。实现身份包含实际可执行文件、运行时身份、资源、工具依赖、元数据、锁与 native 字节；模式和运行时版本也参与身份缓存命中条件。安装使用标记不参与身份。

### Linux 运行库

Linux 归档以 glibc 2.39 为基线：ELF 只能依赖 glibc 自身的库（`libc`、`libm`、`libdl`、`libpthread`、`librt` 与解释器 `/lib64/ld-linux-x86-64.so.2`）和 `runtime/lib/` 中的库。只有依赖 glibc 之外随包库的动态 ELF 才设置指向 `runtime/lib/` 的 `$ORIGIN` 相对 RPATH；`runtime/lib/` 中依赖其它随包库的文件同样处理。仅依赖 glibc 自身库且没有逃逸路径的 ELF 保持原字节，不为它新增 RPATH；静态 ELF 不设置。可执行入口不设置 `LD_LIBRARY_PATH`。

组装后检查归档内全部 ELF：解释器、`DT_NEEDED` 全部可在 glibc 或 `runtime/lib/` 中解析、引用的 GLIBC 符号版本不高于 2.39、RPATH 不指向归档之外。任一不满足即组装失败。候选验证在 Ubuntu 24.04 上实际运行，见[从标签发版](use-case/release-from-tag.md#verify)。

### macOS 签名

`bin/concord` 在 macOS 目标任务完成编译与所有字节变换后 ad-hoc 签名，保留 Bun 所需 entitlements。HawDB `.node` 与 `runtime/rg` 同样在 macOS 签名；随后才生成归档与摘要，验证与安装不改写签名字节。验证阶段对全部 Mach-O 运行 `codesign --verify`。安装脚本用 `curl` 下载，不产生 `com.apple.quarantine`；Concord 不做公证，不支持浏览器下载的安装。

### 版本与身份

发版版本只从规范标签写入。应用的 `app/package.json` 写入 `version`，并以 `gitHead` 记录标签 commit，各目标应用从同一 commit 构建。版本、源码标签 commit、各归档的 SHA-256 和 recipe commit 构成发版映射，只有这些身份完全一致时，重跑才能继续中断的阶段。Repository 实现身份包含实际可执行文件、包元数据、依赖锁、资源、外置工具与实际 Bun 版本。

### Homebrew

Formula 按平台引用对应归档与 SHA-256，没有 `depends_on` 的 node、pnpm 或 ripgrep，也不编译原生引擎。安装把归档内容放入 `libexec`，在 `bin` 链接 `libexec/bin/concord`。

macOS 上 Formula 保留原生字节：HawDB 动态库使用可重定位的 `@rpath` 标识，Formula 声明 `preserve_rpath`。安装时压缩包内全部 Mach-O 文件（原生绑定、`bin/concord` 与 `runtime/rg`），待 Homebrew 链接处理结束后在 post-install 解压还原原始字节，不重签、不改写。tap 的 Homebrew 检查逐文件比对还原后的摘要与归档相同，对全部 Mach-O 运行 `codesign --verify`，并确认没有 `com.apple.quarantine`。

### Nix

Nix 只支持 `x86_64-linux`。原始发版身份与渠道安装身份分开：

1. 表达式用 `fetchurl` 按 Release 中的 SHA-256 取 `linux-x64` 归档，recipe 构建先核对原始 native manifest 与绑定字节一致。
2. recipe 构建阶段用 `autoPatchelfHook` 修补归档内全部 ELF（`bin/concord`、HawDB `.node`、`runtime/rg` 与 `runtime/lib/` 中的库），运行库取自 flake.lock 固定的 nixpkgs，至少包含 glibc、GCC 运行库与 libatomic。有库无法解析时构建失败。修补只改 ELF 的解释器与运行库路径，不改应用逻辑与依赖；修补后必须实跑编译程序以验证内嵌载荷仍可加载。
3. 修补后为 HawDB 绑定重写 native manifest `artifact.json`：`revision`、ABI、`target`、源码摘要 `sourceDigest`、锁文件摘要 `cargoLockDigest` 与 `noticesSha256` 保持原值，`binarySha256` 换成修补后字节的 SHA-256。修补后的安装目录与这个 manifest 构成 Nix 渠道的安装身份。

运行时的摘要检查不放宽：Nix 安装的绑定与其它渠道一样，必须与所在安装的 manifest 一致。tap 的 Nix 检查经过 HawDB 身份校验与一次缓存写入后读取，不只运行 `--help`。

### 安装脚本

安装脚本把每个版本解压到 `~/.local/share/concord/<version>/`，链接 `concord` 指向当前版本的 `bin/concord`：

1. 先在同一父目录的临时目录中下载、校验与解压，成功后 rename 为版本目录，并在其中写入 `.archive-sha256`。下载或校验失败只删除自己的临时目录。
2. 版本目录已存在时比对 `.archive-sha256`：相同则复用；不同或缺失则以非零退出，提示删除该目录后重试，不覆盖已有目录。
3. 新链接先写到临时名，再 rename 到目标位置。每次链接指向某个版本，都更新该版本的 `.activated` 时间。旧版本目录不被改写。
4. 清理只考虑同一父目录下的版本目录：跳过当前版本与使用中的版本，其余按 `.activated` 时间保留最近两个，删除更早的。

从安装目录运行的工作区服务启动时在其安装根下创建 `.in-use/<pid>`，正常退出时删除；安装根不可写（例如 Nix store）时不写标记，这些目录也不归安装脚本清理。安装脚本用 `kill -0` 判断标记中的进程是否存活：存活即视为使用中，进程已不存在时删除该标记。PID 被复用时只会多保留一个版本。`.archive-sha256`、`.activated` 与 `.in-use/` 不属于[安装身份](../../engineering/code/architecture.md#基础服务)摘要的内容。安装脚本不向任何服务发信号。

### tap 同步

同步入口用受版本管理的 Formula/Nix 模板生成候选，模板与当前发行 recipe 分开。生成前核验标签、资产 SHA-256 与归档内的版本。完整安装与运行由依赖候选的 Homebrew 与 Nix CI job 验证；最终更新 job 同时依赖两者成功，元数据核验不能替代安装成功。

渠道准备不改写当前可安装版本。新资产存在后同步候选，沿用 base SHA 与已有标签比较，原子更新 recipe 与 recipe 标签。失败保留当前 recipe 和不可变资产，不覆盖既有发版。

## 生命周期

### 归属

Concord 拥有源码校验、归档字节与源码 Release，tap 拥有包管理器元数据与渠道同步。短运行时作用域拥有发布文件租约；runner 作用域另行拥有分离的 POSIX 进程组与持久清理状态。

### 创建

标签事件校验版本并调度默认分支的 Release 工作流，构建时始终检出显式标签。默认分支拥有跨版本可复用的缓存作用域，源码身份仍由标签拥有。tap 只接受固定的公开仓库、规范标签与唯一匹配的资产。

### 运行

Linux 与 macOS 原生任务分别在 Ubuntu 24.04 与 Apple Silicon macOS 15 上下载并验证固定版本的 HawDB 二进制，后者 deployment target 为 macOS 15.0。native manifest 绑定桥接源码、Cargo lock、ABI、HawDB revision 与二进制摘要；本机 Nix 构建的原生产物不进入归档。

各目标宿主在原生任务之后构建应用，使用本目标经核验的原生产物组装候选归档并核验版本与摘要，把候选作为不可变产物上传。汇总任务收集两个目标的候选并生成摘要清单，不重编译或改写候选。

验证任务依赖打包任务，分别在 `ubuntu-24.04` 与 `macos-15` arm64 的 CI 机器上下载本目标的候选与摘要，校验后解压运行，不重新构建，核对项见[从标签发版](use-case/release-from-tag.md#verify)。验证的 `PATH` 只含系统基础命令与 Git，不提供 `node`、`bun`、`pnpm` 或 `rg`。发版任务同时依赖两个验证任务与同一标签 commit 的完整检查。

CI 按[检查入口](../../engineering/testing/README.md#检查入口)分片运行完整套件；性能比较按[性能测量](../../engineering/performance/README.md)单独执行。手动可移植检查必须断言真实的 HawDB 缓存未命中后命中，只回源不算通过。

### 复用

重试任务可以复用成功的不可变产物；commit、版本或资产摘要变化时不能复用。已有源码资产仅在摘要相同时复用，不覆盖不同字节。tap 版本与摘要一致时不下载归档、不运行平台任务；中断的渠道完成记录可由后续发现修复。

原生绑定按固定发行版本缓存；命中后仍校验字节与身份，不编译。HawDB 的编译与发布只由 fork 拥有。

失败任务最多自动重试一次，复用同一运行中已成功的任务与产物。后续定时发现可以重新尝试未完成的元数据同步；安装失败保留当前 recipe。

### 清理

Repository 租约保留既有的收尾逻辑。所拥有的进程依次收到 TERM、有界宽限期与 KILL；观察不到进程组消失即为清理失败。CI 临时的候选归档与候选 recipe 属于 CI 机器的本地资源，每个任务结束后删除。

### 失败归属

运行时清理失败使命令成功不能作为证据。源码矩阵失败阻止源码 Release。tap 验证失败时源码 Release 的归档仍可由安装脚本安装，但 Homebrew 与 Nix 不更新。
