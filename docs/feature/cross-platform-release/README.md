---
format: concord.document/v1
id: cross-platform-release
title: Cross-platform tagged releases
createdAt: 2026-09-21T09:55:08.120Z
kind: feature
constitutionRefs:
  - docs/constitution.md#c-002
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-005
  - docs/constitution.md#c-006
  - docs/constitution.md#c-007
  - docs/constitution.md#c-010
---

# 跨平台标签发布

## 问题

Concord 的 Node 运行时与 POSIX 进程所有权支持 Linux 与 macOS。一个版本标签必须对应一份身份明确的发布，构建、打包、上传、计算哈希与更新 tap 都由自动化完成。

## 核心模型

Concord 仓库拥有源码、版本与源码标签。标签工作流构建一份不可变的包，核验版本与摘要后发布源码资产。完整测试属于开发验证，可通过本地 `pnpm check` 或手动 Check 工作流执行。

公开的 Homebrew tap 发现该发布，核验身份，更新 Formula 与仅限 Linux 的 Nix 输入，生成候选 recipe，再记录自己的 recipe 标签。两个标签共享版本号，但指向不同的 commit。

该工作流同样采用 Concord 驱动开发：先更新契约与设计，再改运行时或发布自动化。平台检查、显式实现关联与测试只证明各自的实际范围。

## 范围

唯一的 npm 发布产物内含 Ubuntu 24.04 与 macOS 15 分别编译的目标原生引擎，在一台 Ubuntu 24.04 runner 上构建、类型检查并合包。发布流水线不运行测试或真实安装，不据此声明运行时验收通过。

macOS 最低支持版本为 15，仅支持 Apple Silicon。macOS 27 在允许安装范围内，但不声明已完成其 CI 实测。渠道同步仅在 Ubuntu 上核验包身份、摘要与生成 Formula/Nix 元数据，不安装 Concord。同一包供所有渠道使用。源码发布成功与渠道同步成功分别报告，tap 同版本 Release 是渠道完成记录。

安装时由 npm 选择目标平台的可选依赖。运行时协调在本地 Linux 与 macOS 工作树上使用 Node 文件 API，不依赖 flock 或磁盘检查工具。依赖为 Node.js 24.15+、Git 与 Repository 工具使用的 ripgrep。Nix 只支持 Linux。

不保证 Windows 执行与网络多机协调。HawDB 是可丢弃缓存。不支持不同锁协议的程序同时运行。

## 入口

- [CLI](cli.md)
- [架构](architecture.md)
- [生命周期](lifecycle.md)

包内含同一固定源码与 Cargo lock 构建的 linux-x64-glibc 与 darwin-arm64 HawDB N-API 引擎，macOS 部署目标为 15.0。原生目标任务先于唯一的打包任务；ABI、源码身份、上游 revision 或摘要缺失或不一致都会阻止发布。

消费者以 `--ignore-scripts` 安装，不需要 Rust 或 HawDB 服务。仅在本机构建的 Nix 产物只用于本地验证。
