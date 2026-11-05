# PR 导出测试的进程存活检查在负载下失败

## 现象

`packed PR export preserves Git object types and refuses unsafe or incomplete exports` 在完整门禁的构建层中失败，失败点是以 `kill(pid, 0)` 判断进程存活的断言（`/tmp/p3-packed-prewarm.log`）。同一用例在空闲机器上单独复跑通过（`/tmp/p3-packed-idle-rechecks.log`）。

## 期望

测试等待真实的进程退出状态，不以某一时刻的存活探测作结论（[共享资源与同步](../engineering/testing/README.md#共享资源与同步)）。不以延长超时或重试消除失败。
