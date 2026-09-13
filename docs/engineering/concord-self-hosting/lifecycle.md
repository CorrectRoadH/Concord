# 维护生命周期

1. 修改契约前用 `show` 或 `page show` 获取当前 owner 和 digest。
2. 用具名命令更新正文，保留 metadata 与历史。
3. 新增或调整真实测试时，在声明正上方维护唯一 case 与 contract 注释；Problem 回归关系按需追加。
4. 运行 TypeScript 类型检查和目标测试，再运行 Concord 的 doctor/check/trace/review。
5. 影响公开包时由维护者在最终验收执行完整 `pnpm check`，其中包含 build、类型检查、领域测试与独立打包消费者 smoke。

版本、安装指南、发布、push 和生产操作不属于本自举 owner 的自动动作，必须由获得明确授权的维护者执行。
