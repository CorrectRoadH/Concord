---
relations:
  - role: spec
    target: docs/feature/herdr-mod/use-case/use-on-remote-machine.md#open
---
# 远端环境找不到 hc 时工作区无法启动

## 观察

Herdr 远程终端可用，Concord mod 在读取与“连不上”之间切换。Studio 上 `hc exec --cwd <仓库> concord --json --root <仓库> server status` 返回 `absent`，而同一命令环境运行 `hc` 返回 `cannot start hc: No such file or directory`。

## 期望

mod 通过宿主的 Herdr core 指定机器和目录托管服务，不要求远端 PATH 包含 `hc`。宿主启动命令失败时显示具名启动错误及可复制的原始诊断，不误报机器断线。

## 复现

`bun run gate test/model/herdr-mod.test.ts --test-name-pattern='remote cold loading|remote hosting'`。
