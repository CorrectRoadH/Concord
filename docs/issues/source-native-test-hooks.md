---
relations:
  - role: adopts
    target: docs/engineering/build/architecture.md
---

# 源码模式拒绝故障注入用的带钩子原生产物

## 现象

CI 分片 1 的步骤 “Verify native transaction failure and crash recovery” 用 `node scripts/build-native.ts --test-hooks` 在私有 `XDG_CACHE_HOME` 编译带钩子的产物后运行 `test/process/hawdb-native.test.ts`，13 项全部报 `HawdbIncompatible: source native artifact identity differs`（run 42174136852、42177882630 的 gate (1)；`/tmp/concord-closure/lead5-ci-previous.log`）。`src/base/installation/native-artifact.ts` 的源码产物校验无条件拒绝 `testHooks: true`。

## 期望

源码模式按 `CONCORD_NATIVE_TEST_HOOKS` 要求匹配 `testHooks`，其余身份项照常全部校验；安装包始终拒绝带钩子的产物（[故障注入产物](../engineering/build/architecture.md#故障注入产物)）。
