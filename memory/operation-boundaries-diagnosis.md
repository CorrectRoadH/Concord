---
format: concord.document/v1
id: operation-boundaries-diagnosis
title: 操作依赖、完整性与恢复回执的边界
createdAt: 2026-09-27T00:22:36.252Z
kind: memory
memoryKind: insight
state: current
epoch: 0
promotions: []
history: []
---

# 操作依赖、完整性与恢复回执的边界

调查来源：GitHub issue #1（https://github.com/CorrectRoadH/Concord/issues/1）。该观察描述 macOS 安装中的死发布锁与恢复结果不一致。当前 Linux 环境复现了死 owner 阻断普通命令，但显式 recover 能回收；因此没有证据认定原 macOS 现场根因已经复现。

本轮确认的结构问题是局部命令先加载全仓库文档、默认独占读取，以及把无 journal 的结果当作整体可写状态。采用的契约见 docs/design/operation-boundaries/README.md 与 docs/constitution.md#c-013，当前架构入口为 docs/architecture.md。

可复用经验：故障隔离必须在读取依赖之前完成；部分 inventory 必须连同 findings 与 complete 传播，遗漏坏记录不能改变物理 owner 归属。只读权限要在所有真实发布共用边界执行，不能只保护某一个入口。恢复回执只能报告实际完成的回收；统一入口之后到达的新 owner 应保留并具名拒绝，由下一次显式恢复记录。父进程死亡不证明 runner 子进程已清理。

独立 Astra 审查发现并推动修正了源码发布权限遗漏、坏嵌套 owner 的祖先回退、引擎二次回收漏报，以及反馈详情丢失完整性字段。专项测试覆盖了共享 reader 下只读源码拒绝、原 run state 保留、部分关系不误归属、反馈完整性，以及普通/Trace 两个恢复引擎的真实进程阶段竞争。这些测试不替代 macOS 现场验收或原生测试覆盖率证明。
