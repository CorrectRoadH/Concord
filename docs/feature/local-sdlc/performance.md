# 本地 SDLC的性能测量

本页拥有 local-sdlc 的测量场景与预算，方法见[性能测量](../../engineering/performance/README.md#测量方法)。场景直接使用 Mitata，入口为 `bench/local-sdlc.bench.ts`。

## 测量场景

| 场景 | 测量内容 |
| --- | --- |
| `local-sdlc/documents-list` | 读取文档列表 |
| `local-sdlc/memory-search` | 检索真实 Memory |
| `local-sdlc/trace-check` | 核验当前关系 |
| `local-sdlc/check` | 合并当前来源检查 |
| `local-sdlc/code-list` | 读取代码声明 |
| `local-sdlc/test-list` | 读取测试声明 |

计时边界为进程内真实操作与其自身资源释放，排除 CLI 宿主启动和格式化。固定输入、消费者与缓存状态由场景源码声明；修改这些条件时重新建立参照结果，不使用整进程数字作为操作预算。

Mitata 的成功退出表示测量完成，预算由交付者对照适用条件与原生统计判断。没有相同边界的参照证据时只报告测量结果，不宣称预算通过。
