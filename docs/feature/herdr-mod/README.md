# 在 Herdr 里使用 Concord

在 Herdr 里一边监督 coding agent，一边读写 Spec。Concord mod 是 Herdr 中的一块原生界面，放在 agent 旁边：在空仓库里初始化 Concord、阅读全部文档、看每个 Use Case 由哪些测试和代码守护、改一页文档并立刻检查，都在 Herdr 里完成，不需要打开浏览器。

## 你可以做什么

- 在终端所在的仓库里初始化 Concord，拿到适合这个项目的写作指南；终端 `cd` 到另一个仓库，mod 跟着切换。
- 终端在远程机器上时，mod 读的是那台机器上的仓库。
- 阅读全部文档：Feature 与 Use Case、品味、术语、Issue 与 Memory，正文按 Markdown 渲染。
- 打开一个 Use Case，看守护它的测试和实现它的代码；点开术语，看它的定义。
- 直接修改一页文档，保存后立刻看到检查结果。
- agent 改了文件，mod 自动刷新，不打断你正在读的位置。

## 上手

Herdr 用户和其它 mod 一样安装：把下面这句话交给自己的 agent。

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: herdr.dev/mods/CorrectRoadH/concord
```

agent 读完 mod 的全部文件，说明它会运行 `concord` 命令、读写当前仓库的文件，再把它复制到 Herdr 的 `mods/` 并检查。mod 依赖终端所在机器上的 Concord；没有安装或版本不匹配时，mod 显示安装或升级 Concord 的命令，不显示文档。详见[从 Herdr 安装 Concord mod](use-case/install-from-herdr.md)。

已经装了 Concord 的用户也可以直接运行（以下为预期输出）：

```sh
concord herdr install
```

```text
Installed Concord mod: ~/.config/herdr-app/mods/concord
Herdr loads it on save; open it with the "Concord" command.
```

在 Herdr 中打开 Concord mod，它在当前 pane 的右侧分出一个面板，已经打开时聚焦它；当前 tab 里没有终端时以浮层打开，提示先打开一个终端。安装与打开都不改变你的布局。

mod 跟随它所在 tab 里最近聚焦的终端：读那个终端当前目录所在的仓库，终端 `cd` 到另一个仓库时跟着切换，所以 mod 没有“选择目录”。内容变化时 mod 自动刷新，所以也没有“刷新”。这个仓库还没有初始化时，mod 显示“在这里初始化 Concord”；点一下，mod 运行 `concord init`，列出新建的文档，并给出让 agent 读的写作指南。已经初始化的仓库直接显示 Feature 列表。

## 怎样工作

CLI、Web 工作台与 mod 用同一个项目的工作区服务：mod 调用 `concord --json`，命令自动启动或复用这个服务，Web 工作台也由它提供，所以三边看到同一份缓存与检查结果。

mod 不保存任何事实。它用 `concord --json` 取得文档列表、关系和检查结果，直接读取文件正文来显示，保存时直接写文件，再运行 `concord check`。监听到 `docs/`、`memory/` 或测试与源码目录变化时，重新取数据刷新。查询命令自动启动或复用项目的工作区服务，与其它 CLI 调用共享缓存；生命周期由[工作区服务](../local-data-engine/architecture.md#cli-查询)拥有。

终端在远程机器上时，mod 通过 Herdr 在那台机器上运行 `concord`、读取文件，看到的与在那台机器上运行 CLI 相同。Herdr 还不能把文件写到其它机器，也不能监听那里的目录，所以远程仓库在 mod 里只读，刷新改为定时询问，见[在远程机器的终端旁使用](use-case/use-on-remote-machine.md)。

图解里的 p5 动画需要浏览器才能播放。mod 显示图解的文字说明与源码，并提供“在浏览器中播放”。

## 用户路径

- [在空仓库里初始化 Concord](use-case/init-from-herdr.md)
- [阅读 Spec 与它的测试和实现](use-case/read-spec.md)
- [修改一页文档并检查](use-case/edit-and-check.md)
- [agent 改了文件，mod 自动刷新](use-case/follow-changes.md)
- [在远程机器的终端旁使用](use-case/use-on-remote-machine.md)

## 细节

- [命令](cli.md)
- [实现](architecture.md)

## 性能

高频操作的性能预算见[在 Herdr 里使用 Concord的性能预算](performance.md)。

## 在真实主机上验收

在装有 Herdr 的机器上，用 `herdr-app check <mod 目录>` 加载归档中的 Concord mod，用 `herdr-app shot` 截图核对界面。

## 依据的品味

- [读得懂胜过写得全](../../taste.md#t-1)
- [文件是界面，命令只是助手](../../taste.md#t-6)
- [快到每次都愿意跑](../../taste.md#t-7)
