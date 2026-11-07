# 统一的本地缓存与检索引擎的性能预算

本页声明 local-data-engine 高频操作的性能预算，测量方法见[性能测量](../../engineering/performance/README.md#测量方法)，表格写法见[预算表](../../engineering/performance/format.md#预算表)。

## 性能预算

按[性能测量](../../engineering/performance/README.md#测量方法)的参照消费者、环境及七次新进程采样，已有可读投影的读取命令满足以下 warm p50 预算。没有投影的首次读取等待后台刷新，耗时受[刷新上限](#刷新上限)约束，不计入 warm 预算。当前来源模式另外执行原有命令预算和同机交错对照。

| 场景 | 测量内容 | p50 预算 |
| --- | --- | ---: |
| `local-data-engine/trace-gaps-warm`、`local-data-engine/trace-show-warm`、`local-data-engine/review-warm` | 已有诊断投影的历史读取 | 600ms |
| `local-data-engine/cache-status` | 缓存状态 | 670ms |

## 刷新上限

后台刷新进程通过内部扫描入口执行下表场景的当前来源扫描，三类查询各有一行；测量对象是该内部入口。从刷新进程开始等待同键刷新到扫描子进程退出的总时间不得超过上限；超出即终止扫描，结果不发布，此时没有上一代投影的首次读取返回 QueryPending。上限按最大值在任何机器判定，测量规模包括[性能测量](../../engineering/performance/cli.md#消费者)的 `scale` 消费者。

| 场景 | 测量内容 | 上限 |
| --- | --- | ---: |
| `local-data-engine/trace-gaps-refresh` | 关系缺口来源扫描 | 120000ms |
| `local-data-engine/trace-show-refresh` | 单个 Feature 关系扫描 | 120000ms |
| `local-data-engine/review-refresh` | 审阅材料来源扫描 | 120000ms |
