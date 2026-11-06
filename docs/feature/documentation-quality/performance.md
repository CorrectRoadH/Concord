# 文档写作与领域术语的性能预算

本页声明 documentation-quality 高频操作的性能预算，测量方法见[性能测量](../../engineering/performance/README.md#测量方法)，表格写法见[预算表](../../engineering/performance/format.md#预算表)。

## 性能预算

按[性能测量](../../engineering/performance/README.md#测量方法)测量，参照环境为 AMD Ryzen 7 5800X、Linux x64、Node v24.19.0，参照消费者是本仓库的冻结副本。scale 含 1000 个附页，每页约 10 KiB 正文。

| 场景 | 测量内容 | p50 预算 |
| --- | --- | ---: |
| `documentation-quality/docs-check` | 本仓库冻结副本的写作检查 | 1000ms |
| `documentation-quality/check` | 同一冻结副本的合并检查 | 2300ms |
| `documentation-quality/check-server` | 同一冻结副本经由运行中的工作区服务的合并检查 | 2300ms |
| `documentation-quality/docs-check-scale` | 1000 页、每页约 10 KiB | 5000ms |
| `documentation-quality/concepts-index` | 列出全部术语 | 650ms |

场景准备由 `bench/documentation-quality.bench.ts` 与 `bench/fixtures/` 拥有。
