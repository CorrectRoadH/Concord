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

   本机没有 `concord` 时，mod 显示“这个 mod 需要 Concord 命令行工具”和一段交给 agent 的请求（以下为预期输出）：

   ```text
   在本机安装 Concord 命令行工具：运行
   curl -fsSL https://github.com/CorrectRoadH/Concord/releases/latest/download/install.sh | sh
   然后用 concord --version 确认能运行。
   ```

   命令是[安装脚本](../../cross-platform-release/use-case/install-with-script.md)；agent 也可以按项目 README「Install」一节改用 Homebrew 或 Nix。

3. 点“复制给 agent”，贴给身边的 agent。 {#recheck}

   agent 装好后，mod 在 2 秒内找到 `concord`，按当前 pane 的目录继续，后续与[在空仓库里初始化 Concord](init-from-herdr.md)和[阅读 Spec 与它的测试和实现](read-spec.md)相同。

## 结果

| 情形 | 结果 |
| --- | --- |
| 本机的 Concord 不认识 mod 用到的命令 | 显示它不认识的命令与交给 agent 的升级请求，不显示文档；升级后自动继续 |
| 本机的 Concord 与 mod 来自不同版本 | 只要命令都认识就照常工作 |
| 用户已经装了 Concord | 也可以直接运行 `concord herdr install`，结果相同 |
| 终端位于远程机器 | 检测的是那台机器上的 Concord，交给 agent 的请求写明机器名，见[在远程机器的终端旁使用](use-on-remote-machine.md) |

mod 不记录也不比较 Concord 的版本，以命令是否认识为准。使用者通过 Concord 的 `releases/latest` 入口安装 CLI。独立分发目录见[交付 mod](../../../engineering/build/use-case/share-herdr-mod.md)。

## Spec 来源

[在 Herdr 里使用 Concord](../README.md)；mod 的分发见[独立交付](../../../engineering/build/use-case/share-herdr-mod.md)。
