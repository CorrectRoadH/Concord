# 跨平台标签发版

## 问题

使用者想装上 Concord 就能用，不想先准备某个版本的 Node.js、pnpm 或 ripgrep。维护者想推一个版本标签，就得到身份明确、各渠道都从同一份归档安装的发版。

## 核心模型

Concord 以自带运行时的 CLI 发版：每个目标平台一个归档，里面有内含固定 Bun 运行时与应用字节码的单个可执行文件、该平台的 HawDB 原生绑定、随附资源与固定版本的 ripgrep。使用者的机器只需要 Git。

Concord 仓库拥有源码、版本与源码标签。标签工作流为每个目标平台构建一个不可变候选归档，核验版本与摘要，再在每个目标的真实系统上解压同一份候选归档并运行；这些验证与同一标签 commit 的完整检查都通过后才创建 GitHub Release。Concord 只以 CLI 交付；配置、adapter 协议与 PR 预览产物的 JSON Schema 由同一版本的 `concord schema` 输出，见[机器可读 Schema](../local-sdlc/cli.md#机器可读-schema)。

公开的 Homebrew tap 发现该发版，核验身份，用同一归档生成 Formula 与仅限 Linux 的 Nix 候选，安装运行检查通过后记录自己的 recipe 标签。两个标签共享版本号，指向不同的 commit。

## 上手示例

维护者在已推送的 commit 上打标签：

```sh
git tag -a v0.9.0 -m 'Concord 0.9.0'
git push origin v0.9.0
```

使用者在 Linux x64 或 Apple Silicon macOS 上安装：

```sh
curl -fsSL https://github.com/CorrectRoadH/Concord/releases/latest/download/install.sh | sh
concord --version
```

## 范围

| 目标平台 | 系统 | 渠道 |
| --- | --- | --- |
| `linux-x64` | x86_64 Linux，glibc 2.39 及以上（Ubuntu 24.04 及更新） | 安装脚本、Homebrew、Nix |
| `darwin-arm64` | Apple Silicon macOS 15 及以上 | 安装脚本、Homebrew |

Linux 归档自带 glibc 之外的运行库（libatomic 与 libstdc++），不需要 apt 安装任何包，也不读取 `LD_LIBRARY_PATH`。glibc 低于 2.39 或基于 musl 的发行版不受支持，安装脚本在写文件前拒绝。每次发版前在 Ubuntu 24.04 上运行最终归档，它是受支持的最低系统。

macOS 支持用安装脚本（`curl`）与 Homebrew 安装，两条路径都不给文件加 `com.apple.quarantine`。浏览器手动下载归档会被加上 quarantine，Concord 没有公证，这种安装方式不受支持。

macOS 27 在允许安装范围内，但不声明已完成其 CI 实测。不支持 Intel macOS、Windows 与其它架构，不保证网络多机协调。HawDB 是可丢弃缓存，不支持不同锁协议的程序同时运行。

所有渠道从同一个归档安装，不在使用者机器上运行 pnpm、编译 Rust 或下载依赖。Nix 在 recipe 构建阶段修补归档内的 ELF，安装后的字节与归档不同，以修补后重新生成的摘要作为该渠道的安装身份。源码发版成功与渠道同步成功分别报告，tap 同版本 Release 是渠道完成记录。

## Use Case

- [从标签发版](use-case/release-from-tag.md)：维护者推送标签，得到 GitHub Release 与同步的 Homebrew、Nix 渠道。
- [用一行命令安装](use-case/install-with-script.md)：使用者用 `curl` 安装、升级或回退。

发版资产与错误见 [CLI](cli.md)，归档构成与渠道实现见[架构](architecture.md)。

## 验收

各渠道的安装输入是同一份归档字节，安装后 `concord --version` 相同。发版要求 Ubuntu 24.04 与 Apple Silicon macOS 15 的目标构建、归档汇总及同一标签 commit 的完整检查成功，步骤见[从标签发版](use-case/release-from-tag.md#package)。

## 依据的品味

- [只声称证明过的](../../taste.md#t-5)
