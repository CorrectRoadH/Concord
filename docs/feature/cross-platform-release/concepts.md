# 跨平台标签发版术语表

本页定义发版与渠道同步中的概念。[归档](../../concepts.md#archive)、[发版](../../concepts.md#release)、[原生绑定](../../concepts.md#native-binding)与[安装身份](../../concepts.md#installation-identity)由[全局术语表](../../concepts.md)定义。

## 候选归档 {#candidate-archive}

打包任务为一个目标平台组装、尚未随 Release 发出的归档。验证通过后，Release 附带的就是它的原字节。

候选归档只在一次发版运行中存在；验证任务下载同一份候选归档，不重新构建。

## 目标平台 {#target}

Concord 发版支持的操作系统与架构组合，例如 `linux-x64` 与 `darwin-arm64`。每个目标平台一个归档。

## 渠道 {#channel}

使用者安装 Concord 的途径：安装脚本、Homebrew 与 Nix。各渠道从同一份归档安装。

## 渠道完成记录 {#channel-record}

tap 在 Formula 与 Nix 候选通过安装运行检查后创建的同版本 Release，表示该版本的渠道同步完成。

旧写法：`渠道回执`、`完成回执`

源码 Release 存在不表示渠道完成；只有渠道完成记录表示渠道同步完成。

## recipe 标签 {#recipe-tag}

tap 在渠道更新提交上打的版本标签，与源码标签共享版本号，指向 tap 的 commit。

旧写法：`渠道标签`、`配方`

源码标签由 Concord 仓库拥有，指向发版的源码 commit；两者是不同仓库里的两个标签。

## 安装脚本 {#install-script}

Release 附带的 POSIX `install.sh`：下载本目标平台的归档，按 `SHA256SUMS` 校验，解压到 `~/.local/share/concord/<version>/` 并切换 `concord` 链接。

旧写法：`一行安装脚本`
