---
relations:
  - role: spec
    target: docs/engineering/testing/README.md
---

# 上级写作规则的浏览器测试在 CI 中读到来源变化

## 现象

CI run 42259131130（da57035）分片 2（job 128034140781）中，`test/e2e/scoped-writing-browser.e2e.ts:274` 期望显示上级写作规则的句长上限 140，实际得到 `Sources changed during the snapshot`。同一提交前的本地完整门禁 run-9HOu7W 中这一项通过。分片峰值 5,705,093,120 字节。

CI 提交 879ec2b 分片 2 中，同一文件的另一次失败是 `RecoveryRequired`，日志中出现 `An interrupted publication exists`；与上面的来源变化是否同一原因尚未确定，一并调查。

## 期望

先确定读取期间是谁改动了来源：测试自己的前一步写入尚未收束，还是共享 fixture 的恢复与刷新之间有窗口。测试等待真实的状态后再断言，不延长超时、不重试、不改断言（[共享资源与同步](../engineering/testing/README.md#共享资源与同步)）。根因在产品时由 agent 用项目工具复现、修复并验证。
