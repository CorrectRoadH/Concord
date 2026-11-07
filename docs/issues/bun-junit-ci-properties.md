# Bun 的 CI 报告被门禁拒绝

## 现象

GitHub Actions 的 Bun JUnit 报告在 `testsuite` 下包含 `properties`，记录 CI 地址与提交。用例通过后，门禁仍报 `BunTestReportInvalid: Unexpected JUnit element or file`，违反[官方 Bun 报告的验收规则](../engineering/testing/architecture.md#bun-测试引擎)。

## 复现

运行 `bun run gate test/model/bun-test-engine.test.ts --test-name-pattern='official Bun CI metadata'`。当前解析器将合法的报告元数据误当作测试用例。

## 期望

校验并接受官方报告的 CI 元数据；继续校验测试所属文件、结果和汇总计数，拒绝损坏或意外结构。
