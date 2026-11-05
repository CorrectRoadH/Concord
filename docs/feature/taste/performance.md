# 写下项目的品味的性能预算

本页声明 taste 高频操作的性能预算，测量方法见[性能测量](../../engineering/performance/README.md#测量方法)，表格写法见[预算表](../../engineering/performance/format.md#预算表)。

## 性能预算

按[性能测量](../../engineering/performance/README.md#测量方法)的方法，在 warm 状态下判定 p50。

| 场景 | 测量内容 | p50 预算 |
| --- | --- | ---: |
| `taste/list` | 列出品味条目与依据它们的页面 | 880ms |
| `taste/list-server` | 经由运行中的工作区服务列出品味条目与依据位置 | 880ms |
