# 用一行命令安装 Concord

## 用户目标

使用者想像安装 Herdr 一样，用一条 `curl` 命令装好或升级 Concord，不需要 Homebrew、Nix 或 sudo，也不需要先装 Node.js。

## 起始状态

- Linux x64（glibc）或 Apple Silicon macOS。
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

   脚本检查平台与 Git，从同一个 GitHub Release 下载本平台的[归档](../cli.md#发布资产)，按 Release 中的 `SHA256SUMS` 校验。校验通过后解压到 `~/.local/share/concord/<版本>/`，再把 `~/.local/bin/concord` 指向其中的 `bin/concord`。全部写在用户目录下。

2. 确认版本。 {#verify}

   ```sh
   concord --version
   ```

   `~/.local/bin` 不在 `PATH` 中时，脚本最后一行提示把它加入 shell 配置。

## 结果

| 情形 | 结果 |
| --- | --- |
| 再次运行 | 安装最新版本并切换链接；新版本安装失败时保留原来的版本和链接，只保留最近两个版本 |
| 设置了 `CONCORD_VERSION=0.8.1` | 安装这个版本 |
| 设置了 `CONCORD_INSTALL_DIR` | 把 `concord` 链接放到这个目录，不写 `~/.local/bin` |
| Intel macOS、Windows 或其它架构 | 以非零退出，说明支持的平台与 Homebrew、Nix 的替代方式，不写文件 |
| 没有 Git | 以非零退出，说明缺少 Git 与安装方式，不写文件 |
| 下载失败或校验不符 | 以非零退出，不写安装目录，原有版本不受影响 |

归档自带 Node.js 运行时与 ripgrep，系统中有没有、是哪个版本的 Node.js 都不影响 Concord。脚本不修改 shell 配置、不需要 sudo。Homebrew 与 Nix 安装的 Concord 不受影响，`PATH` 中排在前面的那个生效。

## Spec 来源

[跨平台发布](../README.md)；发布步骤见[从标签发布](release-from-tag.md)。
