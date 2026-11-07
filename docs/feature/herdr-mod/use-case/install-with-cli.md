# 用 Concord 命令安装 mod

## 用户目标

已经装了 Concord 的维护者想在 Herdr 里用 Concord，用一条命令装好 mod；机器上的 Herdr 状态各不相同，命令都要说清楚下一步。

## 起始状态

- `concord --version` 可用。
- 机器上可能没有 Herdr，或者装了但还没打开过。

## 完整路径

1. 安装 mod。 {#install}

   ```sh
   concord herdr install
   ```

   以下为预期输出：

   ```text
   Installed Concord mod: ~/.config/herdr-app/mods/concord
   Herdr loads it on save; open it with the "Concord" command.
   ```

2. 在 Herdr 里打开 Concord。 {#open}

   Herdr 正在运行时立即加载 mod，不需要重启；没有运行时下次打开 Herdr 加载。

## 结果

| 情形 | 结果 |
| --- | --- |
| 没有安装 Herdr：找不到 `herdr-app` 命令，也没有 Herdr 的配置目录 | 返回 `HerdrNotFound`，不写任何文件，提示安装 Herdr 的命令 `curl -fsSL https://releases.herdr.dev/app/install.sh \| sh` 与下一步 `concord herdr install` |
| 装了 Herdr 但还没有打开过：有 `herdr-app` 命令，没有配置目录 | 创建 `mods/concord/` 并安装，提示打开 Herdr |
| 设置了 `HERDR_APP_HOME` | 安装到它下面的 `mods/concord/`，不检查默认目录 |
| 已经装过 | 覆盖为当前版本，输出 `Updated Concord mod` |
| 同名目录不是 Concord 的 mod | 返回 `HerdrModPathOccupied`，不覆盖；提示改名或删除后重试 |
| 有 `herdr-app` 命令 | 安装后运行 `herdr-app check` 检查 mod，检查失败时返回 `HerdrModCheckFailed` 并附上 Herdr 的输出，已写入的 mod 保留以便排查 |
| `concord herdr uninstall` 时没有装过 | 成功，输出 `Concord mod is not installed` |

mod 打开后遇到的情形见[从 Herdr 安装 Concord mod](install-from-herdr.md)与[在空仓库里初始化 Concord](init-from-herdr.md)。终端位于远程机器时，mod 使用那台机器上的 Concord，见[在远程机器的终端旁使用](use-on-remote-machine.md)；`concord herdr install` 只需在 Herdr 所在的机器上运行。

## Spec 来源

[在 Herdr 里使用 Concord](../README.md)；命令与错误见[命令](../cli.md#安装与卸载)。
