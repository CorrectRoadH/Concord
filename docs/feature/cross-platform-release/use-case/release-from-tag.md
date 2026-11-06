# 从标签发布 macOS 与 Linux 归档

## 用户目标

维护者推送一个版本标签，得到每个目标平台一个自带运行时的 Concord 归档、同版本的库包，以及自动同步的 Homebrew 与 Linux Nix recipe，各渠道从同一份归档安装。

## 起始状态

- 本地 master 是 Concord 仓库的主检出，要发布的 commit 已推送到 `origin/master`。
- 维护者有推送标签的权限，本机已完成 `gh auth login`。
- 还没有 `v0.9.0` 标签，也没有同名 Release。
- 本页的输出都是预期输出：发布是外部操作，示例不作为运行证据。

## 完整路径

1. 在已推送的 commit 上完成 Concord 驱动的 Spec、实现与测试工作。 {#prepare}

   ```sh
   pnpm gate --changed
   git push origin master
   ```

2. 创建并推送版本标签。 {#tag}

   ```sh
   git tag -a v0.9.0 -m 'Concord 0.9.0'
   git push origin v0.9.0
   ```

   标签规则见 [CLI](../cli.md#命令)。推送 `v<version>` 或 `concord-v<version>` 会触发 `Dispatch tagged release`，它在默认分支上运行发布工作流 `release.yml`。查看进度：

   ```sh
   gh run watch --repo CorrectRoadH/Concord
   ```

3. 原生任务分别构建固定版本的 `linux-x64` 与 `darwin-arm64` HawDB 引擎；macOS 任务给 HawDB 绑定与 `runtime/rg` 做 ad-hoc 签名。 {#native}

4. 一台 Ubuntu 24.04 runner 打包全部候选资产，同一标签 commit 执行完整检查。 {#package}

   runner 从标签派生版本，构建并类型检查应用一次，为两个目标各组装一个候选归档，打出库包 `concord-sdlc-<version>.tgz`，计算全部资产的 SHA-256。

5. 在 `ubuntu-24.04` 与 `macos-15` arm64 runner 上各验证本目标的候选归档。 {#verify}

   验证任务下载第 4 步产出的同一份候选与摘要，不重新构建，校验摘要后解压，在只含系统基础命令与 Git 的 `PATH`（没有 `node`、`pnpm`、`rg`）中运行：

   | 核对 | 通过条件 |
   | --- | --- |
   | 启动 | `bin/concord --version` 输出标签版本，`bin/concord --help` 以零退出 |
   | 原生绑定 | 包内 HawDB 绑定通过身份校验并被实际加载 |
   | 项目闭环 | 在临时 Git 仓库中 `concord init` 与 `concord check` 成功，退出后没有残留的服务进程 |
   | Web 资源 | 包内 Web 资源存在 |
   | Linux 依赖 | 所有 ELF 只依赖 glibc 与 `runtime/lib/` 中的库，RPATH 指向包内，GLIBC 符号版本不高于 2.39 |
   | macOS 签名 | 全部 Mach-O 通过 `codesign --verify`；`runtime/node` 保留 Node.js 官方签名；用 `curl` 下载并解压的文件没有 `com.apple.quarantine` |

6. 全部通过后发布源码 GitHub Release。 {#publish}

   第 4 步的完整检查和两个目标的验证全部通过后，Release 附带两个归档、库包、`SHA256SUMS` 与[安装脚本](install-with-script.md) `install.sh`，字节与验证过的候选相同。任何一项失败都不发布。

   ```sh
   gh release view v0.9.0 --repo CorrectRoadH/Concord --json assets --jq '.assets[].name'
   ```

   以下为预期输出：

   ```text
   SHA256SUMS
   concord-0.9.0-darwin-arm64.tar.gz
   concord-0.9.0-linux-x64.tar.gz
   concord-sdlc-0.9.0.tgz
   install.sh
   ```

7. 公开 tap 自动同步 Homebrew 与 Nix 渠道。 {#channels}

   tap 发现发布，核验版本、标签、资产与哈希，用同一归档生成 Formula 与 Linux Nix 候选。候选通过 Homebrew 与 Nix 安装运行检查后，tap 提交、打 recipe 标签并创建渠道完成记录。macOS 的 Homebrew 检查同样核对全部 Mach-O 的 `codesign --verify`、与归档相同的原始摘要和没有 `com.apple.quarantine`。确认渠道已完成：

   ```sh
   gh release view v0.9.0 --repo CorrectRoadH/homebrew-tap
   ```

8. 用户安装并确认版本。 {#install}

   ```sh
   brew install CorrectRoadH/tap/concord
   concord --version
   ```

   以下为预期输出：

   ```text
   concord v0.9.0
   ```

   安装脚本与文档中的 Nix flake 得到同一版本。需要配置类型或解码器的项目按[库接口](../../local-sdlc/library.md)安装同版本库包。

9. 发布同版本的 Herdr mod。 {#herdr-mod}

   源码 Release 成功后，发布 workflow 把归档中构建好的 mod、`RECIPE.md` 与截图 `preview.png` 写到本仓库顶层的 `concord/` 目录，以一个提交推到 master。

   目录结构为 `concord/RECIPE.md`、`concord/preview.png` 与 `concord/mods/concord/`（`main.js`、`mod.json`），截图来自真实 Herdr 主机。本仓库带 GitHub topic `herdr-mod`，herdr.dev 按账号与目录名把它列为 `herdr.dev/mods/CorrectRoadH/concord`；`mod.json` 写明要求的最低 Concord 版本，即本次发布的版本。

   `concord/` 是唯一提交到仓库的构建产物，只由发布 workflow 写入，人与 agent 不手改；它不属于源码、测试或 Spec，不参与类型检查、`concord check` 与测试选择。workflow 使用自带的 `GITHUB_TOKEN` 写入。

## 结果

各渠道从相同的归档字节安装，得到相同的 `concord --version`。该工作流不声称支持网络多机协调或 Windows 执行。

| 情形 | 结果 |
| --- | --- |
| 矩阵、身份、摘要、候选验证或运行时清理失败 | 可见，停止所在的发布阶段，不发布源码 Release |
| Formula 或 Nix 候选失败 | 可见，停止渠道更新；源码 Release 保持不变 |
| 第 9 步失败 | 报告失败，不影响源码 Release 与 Homebrew、Nix 渠道 |
| 缺少通知凭据或通知重试耗尽 | 通知步骤非零退出，保留已发布的不可变资产；源码 Release 存在不表示渠道完成 |
| 重跑失败的发布任务 | 复用相同资产，识别已有渠道回执 |

### 渠道通知与恢复

Concord Actions Secret `HOMEBREW_TAP_WORKFLOW_TOKEN` 使用仅授权 homebrew-tap、Actions 读写的 fine-grained token。发布后主动请求同步；主动通知失败时仍可由定时任务发现新版本，不承诺五分钟延迟。

可通过已有登录态补发同步：

```sh
gh workflow run concord-release-sync.yml --repo CorrectRoadH/homebrew-tap --ref main --field tag=v0.9.0
```

确认 tap 的同名 Release 完成回执后，再重跑失败的发布任务。

发布资产与错误见 [CLI](../cli.md)，产物与渠道的实现见[发布产物与渠道](../architecture.md#发布产物与渠道)与[生命周期](../architecture.md#生命周期)，协调边界见[可移植协调架构](../../portable-coordination/architecture.md)。
