---
relations:
  - role: spec
    target: docs/engineering/testing/README.md
---

# 按名字过滤后零个用例的运行被汇总成一个通过的测试

## 现象

`node scripts/test-built.ts --test-name-pattern '^adapter-failure-invocation-diagnostics$' test/domain/test-adapter-diagnostics.test.ts` 没有选中任何用例（领域用例数为 0），却以 0 退出，TAP 汇总为 `# tests 1`、`# pass 1`：文件运行成功被计成一个测试（`/tmp/concord-closure/adapter-diag-zero-runner.log`）。`src/domain/tests/evidence.ts` 按汇总判为已运行并通过，`src/domain/tests/fix-verification.ts` 的修复端不拒绝它，所以修复核验在修复端会接受一次零用例的运行。

## 期望

runner 只把实际执行的用例计入汇总；过滤后零个用例时汇总为 `# tests 0`，产品按现有规则拒绝这一端。先写过滤后零用例的失败回归，再按 `--fixed` 修复。
