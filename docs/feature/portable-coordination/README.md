# 用短发布租约协调本地写入

多个 agent 和命令同时在一个 worktree 里读写文档时，维护者希望它们互不覆盖、中断后能恢复，而且不依赖 flock、diskutil、plutil 或 stat 这类外部程序，打包后的 CLI 在 Linux 与 macOS 上都能直接运行。Concord 只用 Node 文件 API 协调本地 Markdown 的发布；HawDB 只是可丢弃的解析缓存，不拥有发布[租约](../../concepts.md#lease)、源文件的 journal 或[恢复](../../concepts.md#recovery)。

## 你可以做什么

- 在没有 flock、diskutil、plutil 或 stat 子进程的机器上运行 Concord。
- 读取和准备互不相关的修改，不需要持有贯穿整个命令的写锁。
- 只在一致快照和发布提交这两段串行，同一时刻只有一个活跃的 journal。
- 写入中断后按完整前像恢复；计划依赖的文件变了，计划被拒绝。
- 长时间运行的测试不占用文档发布。

## 上手

一个写入持有发布租约时，另一个写入立即报告占用，读取照常：

```sh
concord new memory busy-note
```

```text
ok: false
error: OperationFailed
message: exclusive publication lease is busy (pid=4182 host=my-host mode=exclusive); retry after the operation finishes. For an interrupted operation run concord recover; do not delete the lease directory.
```

```sh
concord list memory
```

```text
list
documents: 
  memory/lease-notes.md — lease-notes
```

持有者异常退出后，运行恢复：

```sh
concord recover
```

```text
Recovery: clean
Journal: clean
Publication tokens reclaimed: 1
Runner: absent
```

完整过程见[不依赖外部锁程序协调本地写入](use-case/coordinate-local-publications.md)。

## 怎样工作

读取不取得发布所有权：它记下读过的文件与目录，返回前再核对一遍，期间有发布就拒绝当前结果。普通写入先乐观地准备计划，只在提交时取得短期独占租约，核对全部依赖与前像后写 journal 再发布。恢复在独占保护下检查 journal 与 runner 状态，不碰未知元数据与外部编辑。访问模式、读者准入与恢复结果见[架构](architecture.md)。

## 用户路径

- [不依赖外部锁程序协调本地写入](use-case/coordinate-local-publications.md)

## 范围

支持同一主机、同一 PID 命名空间内的 Linux 与 macOS 本地 worktree。Git 仍是仓库身份的前提。网络与多主机协调不在保证范围内，不认证任何存储设备。支持的平台由[跨平台标签发版](../cross-platform-release/README.md)拥有。

只支持当前协调协议：不迁移旧的锁格式，不协调混用的可执行版本。当前协议合法的加入过渡状态只在每个[持有者](../../concepts.md#holder)都确认 ESRCH 后回收。

文档与证据源文件是各自的事实，不能当作缓存删除 journal 或证据。回收一个已死亡的发布 token 只证明这个 token 的 ESRCH，不能用来识别一个未复现的 macOS 现场。

## 验收方式

打包后的 CLI 在没有 flock、diskutil、plutil 与 stat 可执行文件的 `PATH` 中运行，并在真实进程中验证[结果表](use-case/coordinate-local-publications.md#结果)的各情形。

## 依据的品味

- [一件事只写一次，其余推导](../../taste.md#t-3)
- [只声称证明过的](../../taste.md#t-5)
