# 在 Herdr 里使用 Concord

在 Herdr 里一边监督 coding agent，一边读写 Spec。Concord 的 Herdr mod 是一块原生界面，放在 agent 旁边：在空仓库里初始化 Concord、阅读全部文档、看每个 Use Case 由哪些测试和代码守护、改一页文档并立刻检查，都在 Herdr 里完成，不需要打开浏览器。

## 你可以做什么

- 选一个目录，在里面初始化 Concord。
- 阅读全部文档：Feature 与 Use Case、品味、术语、Issue 与 Memory，正文按 Markdown 渲染。
- 打开一个 Use Case，看守护它的测试和实现它的代码；点开术语，看它的定义。
- 直接修改一页文档，保存后立刻看到检查结果。
- agent 改了文件，mod 自动刷新，不打断你正在读的位置。

## 上手

以下为预期输出。安装 mod：

```sh
concord herdr install
```

```text
Installed Concord mod: ~/.config/herdr-app/mods/concord
Herdr loads it on save; open it with the "Concord" command.
```

在 Herdr 中打开 Concord mod，它出现在右侧。当前 pane 所在目录还没有初始化时，mod 显示“在这里初始化 Concord”；点一下，mod 运行 `concord init`，然后列出新建的文档。已经初始化的仓库直接显示 Feature 列表。

## 怎样工作

mod 不保存任何事实。它用 `concord --json` 取得文档列表、关系和检查结果，直接读取文件正文来显示，保存时直接写文件，再运行 `concord check`。监听到 `docs/`、`memory/` 或测试与源码目录变化时，重新取数据刷新。机器上运行着工作区服务时，`concord` 命令经由服务返回，速度更快；没有服务也能正常工作。

图解里的 p5 动画需要浏览器才能播放。mod 显示图解的文字说明与源码，并提供“在浏览器中播放”。

## 用户路径

- [在空仓库里初始化 Concord](use-case/init-from-herdr.md)
- [阅读 Spec 与它的测试和实现](use-case/read-spec.md)
- [修改一页文档并检查](use-case/edit-and-check.md)
- [agent 改了文件，mod 自动刷新](use-case/follow-changes.md)

## 细节

- [命令](cli.md)
- [实现](architecture.md)

## 性能预算

| 场景 | 测量内容 | p50 预算 |
| --- | --- | ---: |
| `herdr-mod/first-screen` | 已初始化的仓库，从打开 mod 到 Feature 列表可读 | 300ms |

## 刷新上限

| 场景 | 测量内容 | 上限 |
| --- | --- | ---: |
| `herdr-mod/push` | 文件写入停止到 mod 显示新内容 | 1000ms |

## 依据的品味

- [读得懂胜过写得全](../../taste.md#t-1)
- [文件是界面，命令只是助手](../../taste.md#t-6)
- [快到每次都愿意跑](../../taste.md#t-7)
