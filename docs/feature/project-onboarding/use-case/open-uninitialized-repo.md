# 在还没初始化的仓库里打开 Concord

## 用户目标

维护者或 agent 在一个还没用 Concord 的 Git 仓库里运行命令、打开 Web 工作台或 Herdr mod，希望立刻知道要先初始化，以及怎样初始化，而不是看到一个空的“通过”结果。

## 起始状态

- 当前目录是 Git worktree，项目目录下没有 `docs/taste.md`。init 一定创建这个文件，所以它不存在就表示还没有初始化。

## 完整路径

1. 运行需要项目的命令。 {#cli}

   ```sh
   concord check
   ```

   以下为预期输出，退出 1：

   ```text
   ok: false
   error: ProjectNotInitialized
   message: This repository has not been initialized for Concord.

   Initialize: concord init
   Writing guide after init: concord --skill docs-from-scratch
   ```

   `--json` 输出 `{"ok":false,"error":"ProjectNotInitialized","message":"...","details":{"root":"...","guide":"docs-from-scratch"}}`，`guide` 按[选哪份指南](start-writing-specs.md#选哪份指南)的规则给出。

2. 打开 Web 工作台。 {#web}

   `concord view` 照常启动，页面只显示“这个仓库还没有初始化 Concord”、初始化按钮与推荐的写作指南；点初始化与运行 `concord init` 的结果相同，完成后进入文档页。

3. 在 Herdr 里打开 mod。 {#herdr}

   见[在空仓库里初始化 Concord](../../herdr-mod/use-case/init-from-herdr.md)。

## 结果

| 命令或入口 | 在未初始化的仓库里 |
| --- | --- |
| `--help`、`--version`、`--skill`、`init`、`template`、`herdr install`、`herdr uninstall` | 照常执行 |
| `server start`、`server run`、`server status`、`server stop` | 照常执行：它们只管理工作区服务的生命周期，`view` 的初始化页由服务提供 |
| `doctor` | 退出 0，`findings` 包含 `ProjectNotInitialized`，`nextSteps` 第一项是 `concord init` |
| `view` | 显示初始化页，见第 2 步；`view export` 返回 `ProjectNotInitialized` |
| 其它读取或写入项目的命令，例如 `check`、`list`、`show`、`trace`、`test`、`code`、`new`、`skills install` | 返回 `ProjectNotInitialized`，退出 1，不写文件、不创建私有状态 |
| 不在 Git worktree 中 | 沿用已有的项目目录错误，提示进入仓库或用 `--root` |

## Spec 来源

[目标与范围](../README.md)；错误码见 [CLI](../../local-sdlc/cli.md#接入)。
