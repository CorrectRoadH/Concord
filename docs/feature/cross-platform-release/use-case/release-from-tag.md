# 从标签发版 macOS 与 Linux 归档

## 用户目标

维护者推送一个版本标签，得到每个目标平台一个自带运行时的 Concord 归档，以及自动同步的 Homebrew 与 Linux Nix recipe，各渠道从同一份归档安装。

## 起始状态

- 本地 master 是 Concord 仓库的主 worktree，要发版的 commit 已推送到 `origin/master`。
- 维护者有推送标签的权限，本机已完成 `gh auth login`。
- 还没有 `v0.9.0` 标签，也没有同名 Release。
- 本页的输出都是预期输出：发版是外部操作，示例不作为运行证据。

## 完整路径

1. 在已推送的 commit 上完成 Concord 驱动的 Spec、实现与测试工作。 {#prepare}

   ```sh
   bun run gate --changed
   git push origin master
   ```

2. 创建并推送版本标签。 {#tag}

   ```sh
   git tag -a v0.9.0 -m 'Concord 0.9.0'
   git push origin v0.9.0
   ```

   标签规则见 [CLI](../cli.md#命令)。推送 `v<version>` 或 `concord-v<version>` 会触发 `Dispatch tagged release`，它在默认分支上运行发版工作流 `release.yml`。查看进度：

   ```sh
   gh run watch --repo CorrectRoadH/Concord
   ```

3. 原生任务下载并校验固定发行版本的 `linux-x64` 与 `darwin-arm64` HawDB 引擎；macOS 任务保留绑定签名并给 `runtime/rg` 做 ad-hoc 签名。 {#native}

4. 两个目标宿主分别生成候选归档，同一标签 commit 执行完整检查。 {#package}

   Ubuntu 24.04 x64 与 macOS 15 arm64 各自从同一标签派生版本，完成类型检查、资源准备与 Bun 编译、字节码和最终签名，组装本目标候选。汇总任务验证身份与摘要，复制原字节并生成最终 SHA256SUMS，不重新编译。

5. 全部通过后创建源码 GitHub Release。 {#publish}

   第 4 步的完整检查和两个目标的构建全部通过后，Release 附带两个归档、`SHA256SUMS` 与[安装脚本](install-with-script.md) `install.sh`，字节与构建产出的候选相同。任何一项失败都不发版。

   ```sh
   gh release view v0.9.0 --repo CorrectRoadH/Concord --json assets --jq '.assets[].name'
   ```

   以下为预期输出：

   ```text
   SHA256SUMS
   concord-0.9.0-darwin-arm64.tar.gz
   concord-0.9.0-linux-x64.tar.gz
   install.sh
   ```

6. 公开 tap 自动同步 Homebrew 与 Nix 渠道。 {#channels}

   tap 发现这次发版，核验版本、标签、资产与哈希，用同一归档生成 Formula 与 Linux Nix 候选。候选通过 Homebrew 与 Nix 安装运行检查后，tap 提交、打 recipe 标签并创建渠道完成记录。macOS 的 Homebrew 检查同样核对全部 Mach-O 的 `codesign --verify`、与归档相同的原始摘要和没有 `com.apple.quarantine`。确认渠道已完成：

   ```sh
   gh release view v0.9.0 --repo CorrectRoadH/homebrew-tap
   ```

7. 用户安装并确认版本。 {#install}

   ```sh
   brew install CorrectRoadH/tap/concord
   concord --version
   ```

   以下为预期输出：

   ```text
   concord v0.9.0
   ```

   安装脚本与文档中的 Nix flake 得到同一版本。编辑器与脚本使用的 JSON Schema 由同一版本 CLI 的 [`concord schema`](../../local-sdlc/cli.md#机器可读-schema) 输出。

Concord mod 的仓库分发目录按[独立交付](../../../engineering/build/use-case/share-herdr-mod.md)更新；本工作流只在归档中携带 mod，不写入 master。

## 结果

各渠道从相同的归档字节安装，得到相同的 `concord --version`。该工作流不声称支持网络多机协调或 Windows 执行。

| 情形 | 结果 |
| --- | --- |
| 构建、完整检查、身份或摘要失败 | 可见，停止所在的发版阶段，不创建源码 Release |
| Formula 或 Nix 候选失败 | 可见，停止渠道更新；源码 Release 保持不变 |
| 缺少通知凭据或通知重试耗尽 | 通知步骤非零退出，保留已上传的不可变资产；源码 Release 存在不表示渠道完成 |
| 重跑失败的发版任务 | 复用相同资产，识别已有的渠道完成记录 |

### 渠道通知与恢复

Concord Actions Secret `HOMEBREW_TAP_WORKFLOW_TOKEN` 使用仅授权 homebrew-tap、Actions 读写的 fine-grained token。发版后主动请求同步；主动通知失败时仍可由定时任务发现新版本，不承诺五分钟延迟。

可通过已有登录态补发同步：

```sh
gh workflow run concord-release-sync.yml --repo CorrectRoadH/homebrew-tap --ref main --field tag=v0.9.0
```

确认 tap 已创建同名 Release 作为渠道完成记录后，再重跑失败的发版任务。

发版资产与错误见 [CLI](../cli.md)，产物与渠道的实现见[发版产物与渠道](../architecture.md#发布产物与渠道)与[生命周期](../architecture.md#生命周期)，协调边界见[可移植协调架构](../../portable-coordination/architecture.md)。
