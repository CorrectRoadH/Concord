# 远端 Issue 截止时间测试在负载下得到错误的失败类型

## 现象

源码层测试 `test/domain/issue-remote-deadline.test.ts:46` 在一次完整门禁中失败：`fresh.failure` 不是期望的 `IssueNoChange`。当时机器同时运行源码层、构建与静态检查，日志见 `/tmp/p3-full-gate-operation.log`。同一文件在空闲机器上单独复跑通过（762.6 ms，`/tmp/p3-issue-deadline-idle.log`）。

## 期望

测试等待真实的产品状态，结论不受机器负载影响（[共享资源与同步](../engineering/testing/README.md#共享资源与同步)）。截止时间用注入的时钟推进，不依赖实际耗时。不以放宽断言、延长超时或重试消除失败。

## 修复

找出该用例中仍依赖实际时长的部分，改为由 TestClock 推进；先在负载下或暂停相关进程复现失败，再修复。
