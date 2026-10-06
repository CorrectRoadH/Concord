# realpath-compare

## Problem

逐次读取重复枚举仓库根之上与仓库内的宽目录。

## Core Mental Model

快照内的读取不再逐级枚举，改为 `realpathSync.native(target)` 与期望的绝对路径逐字节比较，再 `lstat` 叶子。

## Scope

只改变快照内读取。接受的取舍：本机探针显示 APFS 上 `realpathSync.native` 会把大小写还原为磁盘拼写，但 Unicode 规范化的返回值未验证；`realpath` 也不能证明祖先目录身份未被替换为另一真实目录，且每次读取仍有叶子竞态。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-no-read-through-an-unsafe-path) | satisfied | realpath 解析出的 symlink 或越界使比较失败 | [架构](architecture.md) |
| [L2](../../LIMITS.md#l2-no-time-based-trust) | satisfied | 不缓存 | [架构](architecture.md) |
| [L3](../../LIMITS.md#l3-darwin-spelling-stays-exact) | pending | 大小写经探针确认会还原；Unicode 规范化未验证 | [架构](architecture.md) |
| [L4](../../LIMITS.md#l4-writes-unchanged) | satisfied | 写入不变 | [架构](architecture.md) |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-read-cost-independent-of-ancestor-width) | satisfied | 不枚举目录 | 场景 C4 |
| [G2](../../GOALS.md#g2-refresh-scan-within-the-limit) | pending | 每次读取一次 realpath，需实测 | 场景 C6 |

## Entry Points

- [Architecture](architecture.md)
