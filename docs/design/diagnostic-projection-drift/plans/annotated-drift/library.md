# 模块

| 模块 | 职责 |
| --- | --- |
| `src/query-scan-protocol.ts` | `QueryScanMessage` Schema，扫描进程与刷新进程共享 |
| `src/query-scan-worker.ts` | 内部扫描入口：打开只读乐观仓库，在 `observeProjection` 中运行查询，分拣漂移 finding，写一条消息 |
| `src/query-values.ts` | 三个查询值的 Schema、去除 owner 与远端正文、服务时安全读取并填回正文 |
| `src/query-cache.ts` | v3 envelope、替换规则、前台读取与输出组装 |
| `src/query-refresh-worker.ts` | 身份前后核对、启动扫描进程、失败分类、发布 |

`traceGaps`、`traceShow` 与 `renderReview` 各拆出“接收已分拣 trace、返回结构化值”的函数。公开 CLI 的当前来源路径对同一函数的结果直接输出，保证同源 `--fresh --dry-run` 结果与历史投影填回正文后的结果在排除 `projection`、`cache` 字段后逐字节相同。`renderReview` 的结构化值按片段输出，宪法正文以 path 与 digest 占位。
