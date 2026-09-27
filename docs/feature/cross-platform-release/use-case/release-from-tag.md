---
format: concord.document/v1
id: release-from-tag
title: Release tested macOS and Linux packages from a tag
createdAt: 2026-09-21T09:55:09.057Z
kind: use-case
feature: docs/feature/cross-platform-release/README.md
---

# 从标签发布 macOS 与 Linux 包

## 用户目标

维护者推送一个版本标签，得到身份明确的 Concord 包，以及自动同步的 Homebrew 与 Linux Nix recipe，各平台使用同一份字节。

## 完整路径

1. 在已推送的 commit 上完成 Concord 驱动的契约、实现与测试工作；源码 `package.json` 与 shrinkwrap 根版本一致。
2. 创建并推送 `v<version>`。
3. 目标任务先构建固定版本的 linux-x64-glibc 与 darwin-arm64 引擎。打包任务从标签派生发布版本，并在其 runner 中更新包元数据。
4. 一台 Ubuntu 24.04 runner 构建、类型检查、只打包一次并核验摘要，产物包含两个目标原生引擎，不执行测试或真实安装。
5. 构建与身份核验通过后发布源码 GitHub Release 与 tgz。测试和安装验证由本地或手动 Check 负责，不作为自动发布任务。
6. macOS Homebrew 安装必须保留原生产物字节。动态库使用可重定位的 `@rpath` 标识，Formula 声明 `preserve_rpath`；安装时压缩原生 addon，待 Homebrew 链接处理结束后在 post-install 解压还原原始字节。公开 tap 自动发现发布，核验版本、标签、资产与哈希，准备 Formula 与 Linux Nix 元数据。渠道同步只在 Ubuntu 生成与核验元数据，不安装 Concord；通过后提交、打 recipe 标签并创建渠道完成记录。
7. 用户通过 `brew install CorrectRoadH/tap/concord` 或文档中的 Nix flake 安装，看到对应标签的版本。

## 结果

各渠道得到相同的包字节与 `concord --version`。矩阵、身份、摘要、运行时清理、Formula 或 Nix 失败都可见，并停止所在的发布阶段。该工作流不声称支持网络多机协调或 Windows 执行。

## 契约来源

- [CLI](../cli.md)
- [架构](../architecture.md)
- [生命周期](../lifecycle.md)
- [可移植发布协调设计](../../../design/portable-publication/README.md)
