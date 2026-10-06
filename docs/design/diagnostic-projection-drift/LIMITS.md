# Limits

## L1: No current authority

任何诊断投影，不论一致与否，都不能授权 check 成功、trace check、写入、恢复、fixed 或证据裁决；`current` 恒为 false。依据 [C-004](../../constitution.md#c-004) 与 [C-014](../../constitution.md#c-014) 第 4 款。

## L2: Unknown stays unknown

不一致投影中的缺失关系、零 gap 与零 finding 必须标为未知；人类输出明示结果可能不完整，JSON 携带 `consistent: false`、`changedPaths` 与 `unknownRelations: true`。已有一致投影不能被不一致投影替换。依据 [C-013](../../constitution.md#c-013) 第 2 款与 [C-014](../../constitution.md#c-014) 第 4 款。

## L3: Strict decoding and identity

投影记录与投影值都按各查询自己的 Schema 严格解码；配置字节、命令参数、worktree 与安装身份任一变化都不复用旧投影。恢复待处理、配置变化、路径安全失败与无法形成结构的扫描异常不能发布投影。依据 [C-014](../../constitution.md#c-014) 第 3 款。

## L4: Owner bytes stay out of the cache

持久投影不保存 owner 正文；需要正文的输出在服务时通过安全的定向当前读取取得，并核对投影记录的摘要。依据 [C-001](../../constitution.md#c-001) 第 4 款。

## L5: Compatible machine output

`--json` 既有字段、错误码与退出码含义不变；新增字段不改变旧字段语义。QueryPending 在无任何投影时保持退出码 1。依据 [C-015](../../constitution.md#c-015)。

## L6: Bounded refresh

刷新进程仍受[刷新上限](../../feature/local-data-engine/use-case/query-asynchronous-projections.md#刷新上限)、4MiB 输出上限、每查询键一个刷新 owner 与有界发布重试约束；排队中的请求必须能判定已被某次开始于请求之后的扫描满足，不重复扫描。依据 [C-014](../../constitution.md#c-014) 第 1 款。
