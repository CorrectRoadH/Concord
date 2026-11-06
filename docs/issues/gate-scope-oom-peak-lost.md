---
relations:
  - role: adopts
    target: docs/engineering/testing/README.md
---

# 门禁 scope 因 OOM 终止后丢失内存峰值

## 现象

GitHub runner 上 systemd user scope 可用，普通 scope 用例通过；`test/process/gate-resources.test.ts:20` 的 OOM 用例以 `MemoryMax=134217728` 运行时，scope 执行报 `PlatformError: Unknown: ChildProcess.exitCode`，`resources.json` 的 `memoryPeakBytes` 为 `null`（期望达到上限）。证据 `/tmp/concord-closure/lead5-ci-scope.log:1587-1630`，run 42177882630 gate (3)。本机三个用例通过。推测 128 MiB 在导入阶段即被终止，unit 回收后无法再读 `memory.peak`。

## 期望

超出 `MemoryMax` 时只终止门禁本身：调用方存活、以非零退出，报告中的实际内存峰值可读（[共享资源与同步](../engineering/testing/README.md#共享资源与同步)）。不以提高上限或放宽断言规避。

## 复现

`node --test test/process/gate-resources.test.ts`（在 systemd user scope 可用的 CI runner 上）。
