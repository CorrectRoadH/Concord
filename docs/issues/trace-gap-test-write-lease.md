---
relations:
  - role: adopts
    target: docs/engineering/testing/README.md
---

# 缺口自举测试申请 checkout 写租约

## 现象

最终完整门禁中，`test/domain/trace-gap-issues.test.ts` 以 `RepositoryBusy` 失败（pid 1848854；`.test-results/run-xFW3Rp`，`/tmp/concord-closure/lead5-full-gate-final.log:2837`）。该测试对本仓库派生 `trace gaps`，经 `withRepository` 的默认写模式申请整个 checkout 的独占租约，与门禁中同时运行的其它 checkout 操作冲突。

## 期望

只读本仓库的测试以只读、乐观快照方式读取，关闭持久缓存，不申请写租约，与并行的 checkout 操作互不阻塞（[共享资源与同步](../engineering/testing/README.md#共享资源与同步)）。不以重试掩盖冲突。缺陷在测试自身，修复后按[成本与稳定](../engineering/testing/README.md#成本与稳定)以 `--reason` 关闭。
