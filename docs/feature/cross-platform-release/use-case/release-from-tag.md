# 从标签发布 macOS 与 Linux 归档

## 用户目标

维护者推送一个版本标签，得到每个目标平台一个自带运行时的 Concord 归档，以及自动同步的 Homebrew 与 Linux Nix recipe，各渠道使用同一份字节。

## 完整路径

1. 在已推送的 commit 上完成 Concord 驱动的 Spec、实现与测试工作。 {#prepare}
2. 创建并推送 `v<version>`，命令见 [CLI](../cli.md#命令)。 {#tag}
3. 原生任务分别构建固定版本的 `linux-x64` 与 `darwin-arm64` HawDB 引擎。 {#native}
4. 一台 Ubuntu 24.04 runner 从标签派生版本，构建并类型检查应用一次，为两个目标各组装一个归档并核验摘要；同一标签 commit 执行完整检查。 {#package}
5. 构建、身份核验与完整检查通过后发布源码 GitHub Release，附带两个归档、`SHA256SUMS` 与[安装脚本](install-with-script.md) `install.sh`。 {#publish}
6. 公开 tap 自动发现发布，核验版本、标签、资产与哈希，用同一归档生成 Formula 与 Linux Nix 候选。候选通过 Homebrew 与 Nix 安装运行检查后，tap 提交、打 recipe 标签并创建渠道完成记录。 {#channels}
7. 用户通过安装脚本、`brew install CorrectRoadH/tap/concord` 或文档中的 Nix flake 安装，看到对应标签的版本。 {#install}
8. 源码 Release 成功后发布同版本的 Herdr mod：发布 workflow 把归档中构建好的 mod、`RECIPE.md` 与截图 `preview.png` 写到本仓库顶层的 `concord/` 目录，以一个提交推到 master。 {#herdr-mod}

第 8 步的目录结构为 `concord/RECIPE.md`、`concord/preview.png` 与 `concord/mods/concord/`（`main.js`、`mod.json`），截图来自真实 Herdr 主机。本仓库带 GitHub topic `herdr-mod`，herdr.dev 按账号与目录名把它列为 `herdr.dev/mods/CorrectRoadH/concord`；`mod.json` 写明要求的最低 Concord 版本，即本次发布的版本。

`concord/` 是唯一提交到仓库的构建产物，只由发布 workflow 写入，人与 agent 不手改；它不属于源码、测试或 Spec，不参与类型检查、`concord check` 与测试选择。workflow 使用自带的 `GITHUB_TOKEN` 写入，第 8 步失败时报告，不影响源码 Release 与 Homebrew、Nix 渠道。

## 结果

各渠道得到相同的归档字节与 `concord --version`。矩阵、身份、摘要、运行时清理、Formula 或 Nix 失败都可见，并停止所在的发布阶段。该工作流不声称支持网络多机协调或 Windows 执行。

## Spec 来源

- [CLI](../cli.md)
- [发布产物与渠道](../architecture.md#发布产物与渠道)
- [生命周期](../architecture.md#生命周期)
- [可移植协调架构](../../portable-coordination/architecture.md)

## 渠道通知与恢复

Concord Actions Secret `HOMEBREW_TAP_WORKFLOW_TOKEN` 使用仅授权 homebrew-tap、Actions 读写的 fine-grained token。发布后主动请求同步；缺失凭据或通知重试耗尽会使通知步骤非零退出，保留已发布的不可变资产。源码 Release 存在不表示渠道完成。

可通过已有登录态执行 `gh workflow run concord-release-sync.yml --repo CorrectRoadH/homebrew-tap --ref main --field tag=<tag>` 补发同步。确认 tap 的同名 Release 完成回执后，重跑失败发布任务会复用相同资产并识别已有渠道回执。主动通知失败时仍可由定时任务发现新版本，不承诺五分钟延迟。
