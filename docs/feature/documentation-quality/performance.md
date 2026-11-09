# 文档写作与领域术语的性能测量

本页拥有 documentation-quality 的测量场景与预算，方法见[性能测量](../../engineering/performance/README.md#测量方法)。场景直接使用 Mitata，入口为 `bench/documentation-quality.bench.ts`。

## 测量场景

| 场景 | 测量内容 |
| --- | --- |
| `documentation-quality/writing-check` | 按真实规则检查正文 |
| `documentation-quality/concepts-index` | 读取术语及作用域 |

计时边界为进程内真实操作与其自身资源释放，排除 CLI 宿主启动和格式化。固定输入、消费者与缓存状态由场景源码声明；修改这些条件时重新建立参照结果，不使用整进程数字作为操作预算。

Mitata 的成功退出表示测量完成，预算由交付者对照适用条件与原生统计判断。没有相同边界的参照证据时只报告测量结果，不宣称预算通过。
