# 拒绝漂移

刷新进程保持公开 CLI `--fresh --dry-run` 扫描，构建期间的任何来源变化都使候选拒绝入库。

来源变化记为 `QueryRefreshSourceChanged`。触发条件是扫描以 `SourceChanged` 或 `PreimageChanged`（`source-observation`）失败，或以 `TraceInvalid` 失败且 findings 全为 `SourceChanged`/`CodeSourceChanged`。

`details.changedPaths` 取自 `TraceInvalid` 结构化 findings 中的 path；没有结构化 path 时为 `['.']`，不从消息字符串解析。

超时、输出超限与具名扫描错误按 annotated-drift 的失败分类记录。值 Schema 与正文边界同 annotated-drift。
