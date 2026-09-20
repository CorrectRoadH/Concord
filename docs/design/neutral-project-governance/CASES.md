# 验收场景

1. 普通软件项目使用 command 闭环，不提供 Nx、产品 host、通道或执行器分类。
2. 非 e2e 目录的声明式 suite 能静态查询；host 加载即失败仍可 help、trace 与 Web。
3. 一个真实原生消费者完成 inventory、red、green、隔离/重跑/并行、cleanup、fixed。
4. 已采用 native 要求的 Problem 从任意入口拒绝 command fixed；删配置不能降级。
5. 重开后的旧 invocation、源码/契约/config 漂移、零执行、skip、retry、清理失败被拒绝。
6. 活跃旧锁、pending journal、中断迁移、未知前像不能被新入口绕过。
7. NiceEval 使用新安装包、新配置和真实 runner 完成无付费/无远端副作用的最小正式闭环；产品 CLI 由自身拥有。

上述是验收要求，执行结果另行记录，设计 PASS 不代表这些场景已经通过。
