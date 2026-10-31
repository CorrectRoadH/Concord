# LSP 协议夹具测试的残留清理在负载下失败

## 现象

`LSP protocol fixtures reject unsafe responses, mutations, edits and execution requests` 在完整门禁的构建层中失败，失败点在残留进程清理（`/tmp/p3-packed-prewarm.log`）。同一用例在空闲机器上单独复跑通过（`/tmp/p3-lsp-writing-idle-recheck.log`）。

## 期望

清理确认等待进程组真实退出，结论不受机器负载影响（[共享资源与同步](../engineering/concord-self-hosting/testing.md#共享资源与同步)）。不以延长超时或重试消除失败。
