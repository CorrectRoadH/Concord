---
status: closed
closure:
  kind: closed
  reason: 不再适用：repository-profile 可靠性治理与 RepositoryAdapterUnsupportedPlatform 已退休。当前 src/domain/tests/test-adapters.ts 的 withSession/callProcess 不含 win32 启动前 CleanupUnknown 拒绝；src/base/process/owned-process.ts 在 win32 使用非 detached 子进程，未拥有的进程组不被误判为清理未知。src/base/sources/report-files.ts:10 按现行原生 adapter Spec 对非 Linux 报告读取返回 ReportUnsafe；Linux 上 win32 分支探测已确认该错误，未声称 Windows 实机验收。
---

# 不支持的平台上 adapter 返回了清理未知的错误码

[高级测试治理](../repository-profile.md)规定：没有可观察 POSIX 进程组的平台拒绝进程 transport，返回 `RepositoryAdapterUnsupportedPlatform`，不启动 adapter。

当前实现在 `process.platform === 'win32'` 时返回 `RepositoryAdapterCleanupUnknown`（`repository/process-adapter.ts:82`）。这个代码表示「上一个 adapter 进程组无法确认已回收」，调用方会误以为存在需要人工处理的残留进程。

修复：在启动前按平台返回 `RepositoryAdapterUnsupportedPlatform`，并补充对应测试；`RepositoryAdapterCleanupUnknown` 只用于真实的清理未知。
