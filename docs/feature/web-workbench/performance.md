# 面向人的项目工作台的性能预算

本页声明 web-workbench 高频操作的性能预算，测量方法见[性能测量](../../engineering/performance/README.md#测量方法)，表格写法见[预算表](../../engineering/performance/format.md#预算表)。

## 性能预算

测量场景为 `bench/web-workbench.bench.ts`。四路 HTTP 场景使用独立客户端与服务进程，在冻结的 1112 个源码文件、110 个附页消费者上测量：workspace 请求先发出，10ms 后并发 jobs、file 与 document.set，每次样本的服务准备与关闭不计入请求耗时。document.set 使用相同正文与真实前像摘要，结束后消费者内容与提交保持不变。原生产物正常与摘要不匹配回源分别采样。

| 场景 | 测量内容 | p50 预算 |
| --- | --- | ---: |
| `web-workbench/workspace` | 已有可读结果时的 `GET /api/workspace` | 250ms |
| `web-workbench/jobs` | 并发任务请求 | 211ms |
| `web-workbench/file` | 并发文件请求 | 280ms |
| `web-workbench/document-set` | 并发 document.set 请求 | 550ms |
| `web-workbench/action` | CLI 共享文档动作 | 860ms |
| `web-workbench/git-status` | CLI Git 状态 | 460ms |
| `web-workbench/workspace-projection` | 新进程 `workspace projection --json` | 600ms |

`GET /api/workspace` 的 warm p95 另不超过 600ms。就绪请求不含全量扫描；首次构建另报时长与状态，不计入 warm。jobs、file、document.set、action 与 git-status 的阈值为参照实测 p50 加约 20% 余量取整。
