---
status: closed
closure:
  kind: closed
  reason: 按句柄与打开模式的现行规则，持久库只由工作区服务启动时或 cache rebuild 创建与填充，命令不创建；新 clone 中运行 panel、view 或 server start 后即有持久缓存。原现象记录的回源路径与 UnsafePath 来自已退休的实现。
---

# 新 clone 永远不创建持久缓存

## 现象

2026-10-06 在本仓库的新 `git clone` 中，`concord check --json` 连续运行三次都约 19s（user 11s、sys 10s），主 checkout 约 4.7s。输出中 `cache` 与 `codeCache` 均为 `unavailable`，detail 为 `UnsafePath: No such file or directory`，路径指向不存在的 `.git/concord/cache.hawdb`。`concord cache rebuild --json` 退出码 0，但缓存仍不存在，`cache status` 报告 `empty`。

## 影响

只做只读操作的仓库（新 clone、CI、只运行 check 的 agent）每次都全量回源，违反 [使用统一缓存](../docs/feature/local-data-engine/use-case/use-unified-cache.md) 的“连续命令可以命中缓存”。`pnpm bench cli --consumer self` 的 warm 样本因此实际是 cold，2026-10-06 的 self 记录不能作为预算证据。

## 推断

Git-private 目录 `.git/concord` 只由写入路径（租约、journal）创建；缓存写入以 `create: true` 打开数据库时父目录不存在，失败后静默回源。`cache rebuild` 没有把不可用视为失败。

## 原记录信息

```yaml
createdAt: 2026-10-06T04:50:07.162Z
epoch: 0
evidenceRequirement: command
```
