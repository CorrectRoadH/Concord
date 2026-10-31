# 项目配置源码编辑测试在负载下等不到自动保存

## 现象

`test/e2e/view-authoring-config.e2e.ts:107` 在完整门禁中失败：在源码编辑器中填入新内容后，5 秒内配置文件仍是旧值。随后测试的清理关闭了服务，又使一次保存请求被拒绝连接（`.test-results/run-RifjVO`、`/tmp/p3-final-full-gate.log`）。同一文件在空闲机器上定向运行通过（77.6 s，`/tmp/p3-final-authoring-config-idle.log`）。

## 期望

测试等待真实的产品状态：编辑器完成初始化、自动保存的回执生效，而不是在固定时限内轮询文件字节（[共享资源与同步](../engineering/concord-self-hosting/testing.md#共享资源与同步)）。不以延长超时或重试消除失败。
