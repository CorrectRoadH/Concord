# 跨平台标签发布

## 问题

使用者想装上 Concord 就能用，不想先准备某个版本的 Node.js、pnpm 或 ripgrep。维护者想推一个版本标签，就得到身份明确、各渠道字节相同的发布。

## 核心模型

Concord 发布自带运行时的 CLI：每个目标平台一个归档，里面有启动脚本、固定版本的 Node.js 运行时、构建好的应用、该平台的 HawDB 原生绑定、随包资源与固定版本的 ripgrep。使用者的机器只需要 Git。

Concord 仓库拥有源码、版本与源码标签。标签工作流为每个目标构建一个不可变归档，核验版本与摘要，同一标签 commit 的完整检查通过后发布 GitHub Release。

公开的 Homebrew tap 发现该发布，核验身份，用同一归档生成 Formula 与仅限 Linux 的 Nix 候选，安装运行检查通过后记录自己的 recipe 标签。两个标签共享版本号，指向不同的 commit。

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

| 目标 | 平台 | 渠道 |
| --- | --- | --- |
| `linux-x64` | x86_64 Linux，glibc | 安装脚本、Homebrew、Nix |
| `darwin-arm64` | Apple Silicon macOS 15 及以上 | 安装脚本、Homebrew |

macOS 27 在允许安装范围内，但不声明已完成其 CI 实测。不支持 Intel macOS、Windows 与其它架构，不保证网络多机协调。HawDB 是可丢弃缓存，不支持不同锁协议的程序同时运行。

所有渠道安装同一个归档，不在使用者机器上运行 pnpm、编译 Rust 或下载依赖。源码发布成功与渠道同步成功分别报告，tap 同版本 Release 是渠道完成记录。

## Use Case

- [从标签发布](use-case/release-from-tag.md)：维护者推送标签，得到 GitHub Release 与同步的 Homebrew、Nix 渠道。
- [用一行命令安装](use-case/install-with-script.md)：使用者用 `curl` 安装或升级。

发布资产与错误见 [CLI](cli.md)，归档构成与渠道实现见[架构](architecture.md)。

## 验收

各渠道得到相同的归档字节与 `concord --version`。归档在没有系统 Node.js 的 `PATH` 中运行，打包测试见[检查入口](../../engineering/testing/README.md#检查入口)。

## 依据的品味

- [只声称证明过的](../../taste.md#t-5)
