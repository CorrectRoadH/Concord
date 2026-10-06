# Decision

## Decision

Selected: [annotated-drift](plans/annotated-drift/README.md)

## Rationale

诊断投影与工作区导航使用同一个 `observeProjection` 原语与同一套替换规则。扫描内部复核产生的漂移 finding 先分拣为漂移，再执行完整图门禁，因此 docs、测试与代码编辑下的结果都能诚实标注后作为第一份投影发布。已有一致投影永不被不一致结果替换，陈旧程度不比现状差。失败按开放的具名码追加，不淘汰已有投影；`scannedAt` 保留，同键合并仍能判定请求已满足。

## Rejected Options

strict-reject 让首份投影依赖扫描窗口内没有任何编辑，持续编辑时 C1 恒为 QueryPending，且与工作区导航的漂移语义相反。漂移后在同一刷新内有界重扫一次：持久解析缓存在刷新扫描中关闭，重扫是全量成本，最坏耗时翻倍而且仍不保证收敛，与刷新上限冲突。让不一致结果替换一致结果，或设陈旧时间阈值：违反“未知保持未知”，并破坏与工作区协议的一致。

## Residual Risks

扫描本身超过刷新上限的仓库仍没有投影，需要扫描性能工作解决（rpg-game 实测 178s，见 Memory `refresh-timeout-query-pending`）。不一致投影可能高估 gap，代码来源不稳定时 `unknown` 含 `code`，gap 会显著偏大；只读列表而不检查 `projection.consistent` 的消费者会误读，契约须显式声明。持续编辑下一致投影可能长期停留在旧代次，只由 `lastAttempt` 与人类提示暴露，不自动淘汰。`builtAt` 为兼容 v2 保留发布时间含义，与工作区投影的 `builtAt` 不同。
