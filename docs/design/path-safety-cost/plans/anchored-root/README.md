# anchored-root

## Problem

逐次读取重复枚举仓库根之上与仓库内的宽目录。

## Core Mental Model

路径解析拆成写入用的 `absolute` 与只读用的 `readablePath` 两个入口。仓库打开时对仓库根做一次现有的完整检查，记录根及每个祖先的 bigint `dev`/`ino`，并持有根目录 fd。快照内读取只 `lstat` 祖先核对 inode，不再枚举；仓库内组件仍逐次 `lstat` 检查 symlink，文件以不跟随 symlink 的方式打开并用 `fstat` 比对。Darwin 拼写核对复用本次快照内的目录列表，快照结束时只复核实际查过的条目。

## Scope

只改变 `LocalRepository` 在快照内的文件读取与目录扫描；写入类操作在快照内也走完整检查。接受的取舍：快照内条目的大小写改名在读取时不被立即发现，而在快照结束核验时发现，错误码由 `UnsafePath` 变为 `PreimageChanged`；这不构成越界读取。祖先仅大小写改名时 inode 不变，视为同一仓库。网络文件系统与 overlayfs 上 inode 不稳定时会误拒。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-no-read-through-an-unsafe-path) | satisfied | 每次读取前 `lstat` 祖先核对 inode 并拒绝 symlink；仓库内组件逐次 `lstat`；以 `O_NOFOLLOW_ANY`（Darwin）或 `O_NOFOLLOW` 加 `/proc/self/fd` 比对（Linux）打开并 `fstat` 核对 | [架构](architecture.md#读取检查) |
| [L2](../../LIMITS.md#l2-no-time-based-trust) | satisfied | 目录列表只在快照内复用，快照开始、结束与自身写入时清空；核验使用独立的一次性列表；发布先核验后清空 | [架构](architecture.md#快照内目录列表) |
| [L3](../../LIMITS.md#l3-darwin-spelling-stays-exact) | satisfied | 拼写仍按字节核对；结束时只复核查过的条目及其碰撞别名，漂移路径为条目路径 | [架构](architecture.md#快照结束核验) |
| [L4](../../LIMITS.md#l4-writes-unchanged) | satisfied | 写入、建目录、删除、发布、恢复走 `absolute` 的完整检查 | [架构](architecture.md#两个路径入口) |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-read-cost-independent-of-ancestor-width) | satisfied | 构造后祖先只 `lstat`；读取阶段与核验的拼写检查各自每目录至多列一次；每次成员扫描新鲜枚举 | 场景 C4 |
| [G2](../../GOALS.md#g2-refresh-scan-within-the-limit) | pending | 预计去掉大部分 `readdirSync` 成本，需实测 | 场景 C6 |

## Entry Points

- [Architecture](architecture.md)
