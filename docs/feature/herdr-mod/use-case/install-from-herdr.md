# 从 Herdr 安装 Concord mod

## 用户目标

Herdr 用户在 herdr.dev/mods 看到 Concord，想在自己的 Herdr 里用它读写 Spec，本机可能还没有 Concord。

## 起始状态

- Herdr 已安装，有一个能读写 `~/.config/herdr-app/` 的 agent。
- 本机可能没有 `concord` 命令。

## 完整路径

1. 让 agent 添加 mod。 {#add}

   ```text
   Read ~/.config/herdr-app/AGENTS.md, then add this mod: herdr.dev/mods/CorrectRoadH/concord
   ```

   agent 按 Herdr 的规则先读 `RECIPE.md` 与全部文件，告诉你 mod 会运行 `concord` 命令并读写当前仓库的文件，然后复制到 `mods/concord/`，运行 `herdr-app check`。

2. 打开 mod。 {#open}

   本机没有 `concord` 时，mod 只显示安装说明（以下为预期输出）：

   ```text
   这个 mod 需要 Concord 命令行工具。
   curl -fsSL https://github.com/CorrectRoadH/Concord/releases/latest/download/install.sh | sh
   安装后点“重新检测”。
   ```

   这是[安装脚本](../../cross-platform-release/use-case/install-with-script.md)；也可以用项目 README「Install」一节中的 Homebrew 或 Nix。

3. 安装 Concord 后点“重新检测”。 {#recheck}

   mod 找到 `concord`，按当前 pane 的目录继续，后续与[在空仓库里初始化 Concord](init-from-herdr.md)和[阅读 Spec 与它的测试和实现](read-spec.md)相同。

## 结果

| 情形 | 结果 |
| --- | --- |
| 本机的 Concord 低于 mod 要求的版本 | 显示当前版本、要求的版本与升级命令，不显示文档 |
| 仓库的工作区服务来自另一个 Concord 安装，例如升级后旧版本的服务还在运行 | 显示“这个仓库正被另一个 Concord 安装的服务占用”和“停止它并继续”；点了才停止旧服务，然后照常显示文档，见[状态页](../architecture.md#状态页) |
| 本机的 Concord 高于 mod 的版本 | 照常工作，并提示用 `concord herdr install` 换成同版本的 mod |
| 用户已经装了 Concord | 也可以直接运行 `concord herdr install`，结果相同 |
| 终端位于远程机器 | 检测的是那台机器上的 Concord，安装说明写明机器名，见[在远程机器的终端旁使用](use-on-remote-machine.md) |

mod 要求的最低版本写在它的 `mod.json` 中，来自构建时的 Concord 版本。源码版本 `dev` 不参与发行版排序；使用者通过 Concord 的 `releases/latest` 入口安装 CLI。独立分发目录见[交付 mod](../../../engineering/build/use-case/share-herdr-mod.md)。

## Spec 来源

[在 Herdr 里使用 Concord](../README.md)；mod 的分发见[独立交付](../../../engineering/build/use-case/share-herdr-mod.md)。
