---
relations:
  - role: spec
    target: docs/feature/local-sdlc/architecture.md
---

# 并发读取把进行中的发布当成中断

## 现象

完整门禁 run-j1tq8i（c48bcbd）中，`test/process/workspace-server-operations.test.ts:52` 的 C21 让 4 个只读命令与 1 个写命令在运行的工作区服务上并发，其中一个读命令返回 `RecoveryRequired`：它读到的 `journal.json` 属于仍在发布的真实写入者。负载不高，没有内存触顶，未重试。

## 期望

按[写入管线](../feature/local-sdlc/architecture.md#写入管线)：写入者仍持有发布租约时，读取等这次发布结束后再读；只有没有存活租约持有者的 journal 才返回 `RecoveryRequired`。先写在发布窗口内并发读取的失败回归，再按 `--fixed` 修复。验收同时满足[统一缓存](../feature/local-data-engine/use-case/use-unified-cache.md)中服务运行时读写并发全部成功的要求。
