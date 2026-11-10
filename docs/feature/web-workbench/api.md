# 工作区服务 HTTP 接口

工作区服务为 Web 工作台托管 HTTP 接口，其它程序也可以读取同一份工作区投影。服务的启动与监听见 [CLI 与 Web 操作对应](cli.md)，信任边界见[工作台架构](architecture.md)：接口面向可信网络，不提供身份认证。

## 工作区投影

`GET /api/workspace`（无查询参数）返回 `{ snapshot, projection }`，字段与 [`workspace projection --json`](cli.md#工作区投影) 相同。`ETag` 为响应摘要，匹配时返回 304。GET 不申请刷新，读取不与其它进程争用缓存。

`POST /api/workspace` 只接受 `{}`，申请一次刷新后返回 HTTP 202 `{ ok: true, value: { status: 'requested' } }`，不等待扫描、不读来源。请求沿用 Host/Origin 与 JSON 检查。

错误的含义由 [CLI 页](cli.md#工作区投影)定义，HTTP 映射为：

| 错误 | HTTP |
| --- | --- |
| `WorkspaceProjectionPending` | 202 |
| `WorkspaceProjectionUnavailable` | 503 |
| `CleanupFailed` | 409；只在 HTTP 出现：尚无结果且 View 无法确认刷新进程清理 |

## 状态事件

`GET /api/events` 是 SSE 流，发送结果变化、刷新状态与任务变化。事件只作信号，客户端收到后读取 `GET /api/workspace`。服务停止时先发送 `stopping` 事件。
