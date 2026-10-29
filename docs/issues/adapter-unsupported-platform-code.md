---
format: concord.document/v1
id: adapter-unsupported-platform-code
title: 不支持的平台上 adapter 返回了清理未知的错误码
createdAt: 2026-10-29T21:12:53.829Z
kind: issue
state: draft
memoryRelations: []
adoptions:
  current: []
  history: []
history: []
---

# 不支持的平台上 adapter 返回了清理未知的错误码

[高级测试治理](../repository-profile.md)规定：没有可观察 POSIX 进程组的平台拒绝进程 transport，返回 `RepositoryAdapterUnsupportedPlatform`，不启动 adapter。

当前实现在 `process.platform === 'win32'` 时返回 `RepositoryAdapterCleanupUnknown`（`repository/process-adapter.ts:82`）。这个代码表示「上一个 adapter 进程组无法确认已回收」，调用方会误以为存在需要人工处理的残留进程。

修复：在启动前按平台返回 `RepositoryAdapterUnsupportedPlatform`，并补充对应测试；`RepositoryAdapterCleanupUnknown` 只用于真实的清理未知。
