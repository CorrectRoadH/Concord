# 用一行命令安装 Concord

## 用户目标

使用者想像安装 Herdr 一样，用一条 `curl` 命令装好、升级或回退 Concord，不需要 Homebrew、Nix 或 sudo，也不需要先装 Node.js。

## 起始状态

- Linux x64（glibc 2.39 及以上，例如 Ubuntu 24.04 及更新）或 Apple Silicon macOS 15 及以上，见[范围](../README.md#范围)。
- 已有 Git。

## 完整路径

1. 运行安装脚本。 {#run}

   ```sh
   curl -fsSL https://github.com/CorrectRoadH/Concord/releases/latest/download/install.sh | sh
   ```

   以下为预期输出：

   ```text
   Installing Concord 0.9.0 for linux-x64...
   Concord is installed: ~/.local/bin/concord
   Run: concord --help
   ```

   脚本检查平台与 Git，从同一个 GitHub Release 下载本平台的[归档](../cli.md#发布资产)，按 Release 中的 `SHA256SUMS` 校验。校验通过后解压到 `~/.local/share/concord/<版本>/`，再把 `~/.local/bin/concord` 指向其中的 `bin/concord`。全部写在用户目录下。脚本只下载、校验、解压、切换链接和清理旧版本，不扫描、不停止任何工作区服务。

2. 确认版本。 {#verify}

   ```sh
   concord --version
   ```

   `~/.local/bin` 不在 `PATH` 中时，脚本最后一行提示把它加入 shell 配置。

3. 升级后照常使用。 {#upgrade-running-service}

   某个项目里还运行着旧版本启动的工作区服务时，新版本的第一条命令让它收拢已有工作并退出，再启动自己的服务，然后照常返回结果。不需要手动停止旧服务；这条命令只多花一次服务启动的时间。

## 结果

| 情形 | 结果 |
| --- | --- |
| 再次运行，有更新的版本 | 安装最新版本，原子切换链接；旧版本目录不被改写，仍在运行的旧服务不受影响 |
| 再次运行，已是最新版本 | 已存在且校验相同的版本目录直接复用，只确认链接指向它 |
| 设置了 `CONCORD_VERSION=0.8.1` | 安装这个版本并切换链接，包括比当前更旧的版本（回退）；该版本目录已存在时直接复用 |
| 设置了 `CONCORD_INSTALL_DIR` | 把 `concord` 链接放到这个目录，不写 `~/.local/bin` |
| 安装后清理 | 保留当前版本与最近两个不再使用的版本；有运行中工作区服务的版本属于使用中，不删除，也不计入这两个 |
| 新版本遇到旧服务 | 见第 3 步：新版本替换它，命令照常完成 |
| Intel macOS、Windows 或其它架构 | 以非零退出，说明支持的平台与 Homebrew、Nix 的替代方式，不写文件 |
| glibc 低于 2.39 或 musl Linux | 以非零退出，说明最低支持的系统，不写文件 |
| 没有 Git | 以非零退出，说明缺少 Git 与安装方式，不写文件 |
| 下载失败或校验不符 | 以非零退出，不写安装目录，不切换链接、不清理，原有版本不受影响 |

归档携带内嵌 Bun 运行时的编译可执行文件与 ripgrep，系统中是否安装 Node.js 或 Bun 都不影响 Concord。脚本不修改 shell 配置、不需要 sudo。用 `curl` 下载的文件没有 `com.apple.quarantine`，macOS 直接运行。

Homebrew、Nix 与安装脚本可以同时安装，各自的目录互不改写，`PATH` 中排在前面的那个生效。它们的安装身份不同，同一项目同时只运行一个工作区服务，属于最近使用这个项目的那个安装。

## Spec 来源

[跨平台标签发版](../README.md)；发版步骤见[从标签发版](release-from-tag.md)。
