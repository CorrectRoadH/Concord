# 输出

`trace show`、`trace gaps`、`review render` 的 JSON 中 `projection` 对象新增字段；既有 `current`、`builtAt`、`refresh`、`lastError`（含 `scannedAt`）、`refreshError` 保持原含义：

```json
{
  "projection": {
    "current": false,
    "builtAt": "2026-10-06T03:12:40.311Z",
    "builtFrom": "2026-10-06T03:11:02.904Z",
    "builtUntil": "2026-10-06T03:12:40.118Z",
    "consistent": false,
    "complete": false,
    "changedPaths": ["docs/feature/npc/视觉/本人观察表达.md"],
    "unknownRelations": true,
    "unknown": [],
    "refresh": "requested",
    "lastAttempt": { "scannedAt": 1791256801000, "at": "2026-10-06T03:20:01.000Z", "complete": false, "changedPaths": ["docs/feature/npc/README.md"] },
    "bodyChanged": []
  }
}
```

`lastError.code` 是开放集合；消费者以 `lastError` 是否存在判断最近一次刷新是否失败。

`consistent: false` 时退出码仍为 0，但 `contracts`、`cliPages` 等 gap 列表可能偏大，零 gap 不表示没有缺口；`unknown` 非空时对应关系类别整体未知。只读取列表而不检查 `projection.consistent` 的消费者会误读结果，这一点在异步查询契约中声明。

无投影时 QueryPending 不变（退出码 1），`details.refresh` 为已有的 RefreshFailure 对象；尚无失败记录时为字符串 `"requested"`。

人类输出在 `consistent: false` 时于结果前打印：`历史投影，构建期间来源变化（N 个路径），关系可能不完整；使用 --fresh 获取当前结果。` 已有一致投影且 `lastAttempt.complete` 为 false 时打印：`一致结果构建于 <builtAt>，此后的刷新在编辑中未能取得一致结果（最近 <lastAttempt.at>）。`
