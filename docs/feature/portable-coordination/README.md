# 协调本地写入与恢复

多个 agent 和命令同时在一个项目目录里读写文档时，维护者希望它们互不覆盖、中断后自动恢复，也不因为有人直接用编辑器改了文件而锁死仓库。协调不依赖 flock、diskutil、plutil 或 stat 这类外部程序，打包后的 CLI 在 Linux 与 macOS 上都能直接运行。

所有写入都经由[工作区服务](../../concepts.md#workspace-server)：它在内存中排队提交，用[前像](../../concepts.md#preimage)摘要拒绝过期的计划，用单一 `journal.json` 恢复中断。HawDB 只是可丢弃的缓存，不拥有 journal 或[恢复](../../concepts.md#recovery)。

## 你可以做什么

- 在没有 flock、diskutil、plutil 或 stat 子进程的机器上运行 Concord。
- 读取与准备修改不等待任何写入；只有提交阶段进入[写互斥](../../concepts.md#write-exclusion)。
- 计划依赖的文件变了，写入被拒绝，不覆盖别人的修改。
- 写入中断后，服务下次启动时自动完成或回滚；文件已被外部编辑时以磁盘内容为准。
- 长时间运行的测试不阻塞文档写入。

## 上手

两个写入同时提交时，后到者排队等待；它读过的文件被先到者改了，就被拒绝：

```sh
concord new memory busy-note
```

```text
ok: false
error: SourceChanged
message: memory/README.md changed after the plan was prepared; rerun the command.
```

服务进程被杀后，下一次命令自动启动服务并恢复。也可以显式确认：

```sh
concord recover
```

```text
Recovery: clean
Journal: completed
Test slot: absent
```

完整过程见[协调本地写入与恢复](use-case/coordinate-local-publications.md)。

## 怎样工作

读取访问工作区服务的当前工作区图，不进入写互斥。

写入先基于读到的内容准备计划，提交时进入写互斥，核对计划依赖的文件摘要，写 journal，再逐个原子替换。

恢复按目标文件当前内容决定完成、回滚或放弃 journal，从不阻断后续读写。访问模式与恢复规则见[架构](architecture.md)。

## 用户路径

- [协调本地写入与恢复](use-case/coordinate-local-publications.md)

## 范围

支持同一主机上的 Linux 与 macOS 本地项目目录，Git 仍是仓库身份的前提。网络文件系统与多主机共享同一项目目录不在保证范围内。支持的平台由[跨平台标签发版](../cross-platform-release/README.md)拥有。

只支持当前协调协议：无法解码的 journal 按陈旧记录清理并告警，不迁移旧格式。

文档与证据源文件是各自的事实，不能当作缓存删除。

## 验收方式

打包后的 CLI 在没有 flock、diskutil、plutil 与 stat 可执行文件的 `PATH` 中运行，并在真实进程中验证[结果表](use-case/coordinate-local-publications.md#结果)的各情形。

## 依据的品味

- [文件是界面，命令只是助手](../../taste.md#t-6)
- [一件事只写一次，其余推导](../../taste.md#t-3)
- [只声称证明过的](../../taste.md#t-5)
