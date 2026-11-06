# 从标签发布 macOS 与 Linux 包

## 用户目标

维护者推送一个版本标签，得到身份明确的 Concord 包，以及自动同步的 Homebrew 与 Linux Nix recipe，各平台使用同一份字节。

## 完整路径

1. 在已推送的 commit 上完成 Concord 驱动的 Spec、实现与测试工作；源码依赖声明与 pnpm 锁的根 importer 一致。
2. 创建并推送 `v<version>`。
3. 目标任务先构建固定版本的 linux-x64-glibc 与 darwin-arm64 引擎。打包任务从标签派生发布版本，并在其 runner 中更新包元数据。
4. 一台 Ubuntu 24.04 runner 构建、类型检查、只打包一次并核验摘要，产物包含两个目标原生引擎，并对同一标签 commit 执行完整检查。
5. 构建、身份核验与完整检查通过后发布源码 GitHub Release，附带 tgz、`SHA256SUMS` 与[安装脚本](install-with-script.md) `install.sh`。
6. macOS Homebrew 安装必须保留原生产物字节。动态库使用可重定位的 `@rpath` 标识，Formula 声明 `preserve_rpath`；安装时压缩原生 addon，待 Homebrew 链接处理结束后在 post-install 解压还原原始字节。公开 tap 自动发现发布，核验版本、标签、资产与哈希，准备 Formula 与 Linux Nix 元数据。候选必须通过 Homebrew 与 Linux Nix 安装运行检查；通过后提交、打 recipe 标签并创建渠道完成记录。
7. 用户通过 `brew install CorrectRoadH/tap/concord` 或文档中的 Nix flake 安装，看到对应标签的版本。
8. 源码 Release 成功后发布同版本的 Herdr mod：发布 workflow 把安装包中构建好的 mod、`RECIPE.md` 与真实 Herdr 主机上的截图 `preview.png` 写到本仓库顶层的 `concord/` 目录，结构为 `concord/RECIPE.md`、`concord/preview.png` 与 `concord/mods/concord/`（`main.js`、`mod.json`），以一个提交推到 master。本仓库带 GitHub topic `herdr-mod`，herdr.dev 按账号与目录名把它列为 `herdr.dev/mods/CorrectRoadH/concord`；`mod.json` 写明要求的最低 Concord 版本，即本次发布的版本。

`concord/` 是唯一提交到仓库的构建产物，只由发布 workflow 写入，人与 agent 不手改；它不属于源码、测试或 Spec，不参与类型检查、`concord check` 与测试选择。workflow 使用自带的 `GITHUB_TOKEN` 写入，第 8 步失败时报告，不影响源码 Release 与 Homebrew、Nix 渠道。

## 结果

各渠道得到相同的包字节与 `concord --version`。矩阵、身份、摘要、运行时清理、Formula 或 Nix 失败都可见，并停止所在的发布阶段。该工作流不声称支持网络多机协调或 Windows 执行。

## Spec 来源

- [CLI](../cli.md)
- [架构](../architecture.md)
- [生命周期](../architecture.md)
- 可移植发布协调设计

## 渠道通知与恢复

Concord Actions Secret `HOMEBREW_TAP_WORKFLOW_TOKEN` 使用仅授权 homebrew-tap、Actions 读写的 fine-grained token。发布后主动请求同步；缺失凭据或通知重试耗尽会使通知步骤非零退出，保留已发布的不可变资产。源码 Release 存在不表示渠道完成。

可通过已有登录态执行 `gh workflow run concord-release-sync.yml --repo CorrectRoadH/homebrew-tap --ref main --field tag=<tag>` 补发同步。确认 tap 的同名 Release 完成回执后，重跑失败发布任务会复用相同资产并识别已有渠道回执。主动通知失败时仍可由定时任务发现新版本，不承诺五分钟延迟。
