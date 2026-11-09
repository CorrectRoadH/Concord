---
relations:
  - role: spec
    target: docs/engineering/testing/README.md#共享资源与同步
  - role: spec
    target: docs/feature/local-data-engine/architecture.md#退出
---
# 测试组合中的服务握手与退出等待不稳定

## 现象

Bun 1.4.4 在 `bun run test --parallel=8` 的完整 325 文件运行中出现七个失败及一个 Fixture 清理错误。症状为一秒握手超时、继承的 command scope 不可用、八秒就绪或退出等待超时；原始日志为 `/tmp/concord-final-test-1109.log`。立即用 `--parallel=1` 组合复跑相关七文件仍有六个失败，日志为 `/tmp/concord-test-recheck-1109.log`。

涉及 `cli-uninitialized-service`、`workspace-query-cli-ownership`、`workspace-server-operations`、`workspace-server-handoff`、`workspace-client-write-failure`、`workspace-server-native` 与 `shared-view-fixture`。文件各自单独运行全部通过；同一七文件组合随后以 `--parallel=1` 运行 18 项全部通过、耗时 87.96 秒（`/tmp/concord-final-recheck-1109.log`），首轮失败仍需定位；`workspace-server-operations`、`workspace-client-write-failure` 和 `cli-uninitialized-service` 在同一官方 worker 中组合运行也通过。尚未证明是文件状态泄漏、负载还是产品退出缺陷，不能把定向通过当成完整测试通过。

## 期望

以真实服务生命周期复现失败，观察握手、源版本交接和清理阶段，定位环境或状态差异。保持官方 Bun 调度与原有断言，不恢复逐文件自写 runner，不通过延长超时或自动重试掩盖失败。修复后同一组合与完整测试都通过，Fixture 在退出前确认资源已释放。
