# 验收场景

JSON-only、双配置与嵌套发现返回 ProjectMigrationRequired。旧 journal 优先返回 JournalMigrationRequired，并保持锁、事务与目标字节；损坏当前 scope 严格拒绝。当前 TS 的初始化与配置、源码恢复通过真实文件系统测试。缺少配置绑定的旧收据拒绝作为新证明。完整 pnpm check 覆盖构建和打包消费者。
