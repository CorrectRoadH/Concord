# 项目工作台的性能测量

本页拥有 web-workbench 的测量场景与预算，方法见[性能测量](../../engineering/performance/README.md#测量方法)。场景直接使用 Mitata，入口为 `bench/web-workbench.bench.ts`。

## 测量场景

| 场景 | 测量内容 |
| --- | --- |
| `web-workbench/file-read` | 通过应用操作读取正文 |
| `web-workbench/git-status` | 读取真实 Git 状态 |
| `web-workbench/document-write` | 重置并执行真实文档写入 |
| `web-workbench/workspace-build` | 构建当前工作区快照 |

计时边界为进程内真实操作与其自身资源释放，排除 CLI 宿主启动和格式化。固定输入、消费者与缓存状态由场景源码声明；修改这些条件时重新建立参照结果，不使用整进程数字作为操作预算。

Mitata 的成功退出表示测量完成，预算由交付者对照适用条件与原生统计判断。没有相同边界的参照证据时只报告测量结果，不宣称预算通过。

## 用户可见目标

应用操作的数字不证明 HTTP 请求耗时。已就绪的 `GET /api/workspace` 目标仍为 p50 250ms、p95 600ms；首次构建单独报告。HTTP 并发、响应完成与连接回收由真实协议路径验证，不能以函数微基准替代。
