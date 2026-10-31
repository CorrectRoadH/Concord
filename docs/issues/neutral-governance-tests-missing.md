---
status: closed
closure:
  kind: closed
  reason: 已补当前 Use Case 的源码、打包 CLI 与进程生命周期验收：静态关联不隐式执行 runner，配置缺失边界，Spec→实现/测试→执行→Issue 修复核验→check --since→审阅闭环；定向构建门禁及分层测试通过。
---

# 接入软件项目的 Use Case 没有测试

## 现象

[按 Concord 规范接入软件项目](../feature/neutral-project-governance/use-case/adopt-neutral-governance.md)仍是现行 Use Case，但指向它的测试随 repository profile 的退休一起删除，`trace gaps` 报告它没有测试。

## 差距

为该 Use Case 的现行验收补测试：统一布局、配置的 runner 接入、修复核验与 `check --since` 门禁在一个接入项目中的完整路径。测试按[测试架构](../engineering/concord-self-hosting/test-architecture.md)选层，不恢复已退休的可靠性治理。
