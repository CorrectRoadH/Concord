# 本地数据引擎的性能测量

本页拥有 local-data-engine 的测量场景与预算，方法见[性能测量](../../engineering/performance/README.md#测量方法)。场景直接使用 Mitata，入口为 `bench/local-data-engine.bench.ts`。

## 测量场景

| 场景 | 测量内容 |
| --- | --- |
| `local-data-engine/source-scan` | 当前来源关系扫描 |
| `local-data-engine/cache-status` | 读取真实缓存状态 |

计时边界为进程内真实操作与其自身资源释放，排除 CLI 宿主启动和格式化。固定输入、消费者与缓存状态由场景源码声明；修改这些条件时重新建立参照结果，不使用整进程数字作为操作预算。

Mitata 的成功退出表示测量完成，预算由交付者对照适用条件与原生统计判断。没有相同边界的参照证据时只报告测量结果，不宣称预算通过。

## 刷新上限

后台关系缺口、Feature 关系与审阅材料刷新，从等待同键刷新到扫描子进程退出的总时间不得超过 120000ms。超出即终止扫描、不发布结果，没有上一代投影时返回 QueryPending。该约束需要真实刷新生命周期证据，不能由 Mitata 的批次统计或 `stats.max` 证明。
