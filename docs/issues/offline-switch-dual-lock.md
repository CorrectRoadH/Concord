# 离线切换没有持有新旧锁的受管入口

[治理边界](../feature/neutral-project-governance/architecture.md#离线切换)要求配置、依赖、旧入口与私有协调路径在停写窗口内切换：切换同时持有旧、新 exclusive 锁，先拒绝活跃 writer 与未完成 journal，保存完整前像与可恢复现场。

观察：`src/coordination.ts` 的 `assertLegacyTraceStateMigratedSync` 只在普通运行中拒绝历史 Trace 状态，提示使用原有离线恢复工具。`src/governance-config.ts` 对 `concord.repository/v1` 返回 `GovernanceConfigurationMigrationRequired` 且不提供转换。仓库中没有同时持有新旧锁、校验 journal 与前像的切换命令。

待调查：这一要求应由 Concord 提供受管切换入口，还是由消费者按文档化步骤执行；后者需要在 Spec 中写明操作者步骤与核验方式。
