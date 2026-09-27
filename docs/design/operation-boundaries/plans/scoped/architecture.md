# 操作依赖与资源边界

本页定义已采用方案的精确契约；采用事实由 Design owner 的 decision metadata 记录。

## 操作矩阵

| 操作 | 内容依赖 | 协调 | 失败范围 |
|---|---|---|---|
| memory/issue list、index、recall、search | 相应来源内全部候选 owner | 共享 snapshot | 范围内坏记录、来源缺失、配置或事务障碍 |
| memory/issue edit 的 canonical path | 指定 owner 与当前摘要 | 独占 publication | 目标或其授权依赖、写入资源障碍 |
| memory/issue edit 的短 ID | 相应类别的来源集合及唯一匹配 owner | 独占 publication | 集合不完整、歧义或写入资源障碍 |
| memory/issue create | 目标路径、写来源权限；Issue 的同类 ID 集合；Problem 的证据政策 | 独占 publication | 身份冲突、必要依赖或写入资源障碍 |
| code/test annotate | 每个指定 canonical reference、归属链、类型、anchor；显式 regression Problem | 共享 snapshot | 指定依赖缺陷，不加载全局 Trace |
| show、trace、review | 展示的关系图 | 共享 snapshot | 输出 findings；需要完整图的结论拒绝不完整输入 |
| check | 全仓库事实与关联 | 共享 snapshot | 各 owner 解析错误累计为 findings，ok=false |
| fixed、关系变更、删除 | 当前证明与保证关系完整所需的集合 | 独占 publication | 保留现有严格身份、证据下限和逆向关系要求 |
| recover | publication owner、全部 journal 的排他选择、runner 状态 | 回收已死 publication token 后独占 snapshot | 不确定现场保留；报告剩余阻塞 |

未完成多文件 journal 仍阻断普通快照，避免把半套发布当作有效事实。局部解析隔离不是无锁读取或绕过恢复。来源扫描严格按当前配置和安全目录读取，文件名不推导作者 ID。

## 文档读取职责

Repository 只负责安全读取、配置身份、依赖观察和发布。文档模块决定哪些路径参与当前操作；全局诊断与局部查询共用严格 decoder，但错误传播策略不同。

集合查询先按物理来源限定路径，再解码，不得先全仓库解码再过滤 kind。Feature 与 Use Case 共用物理根时，同根候选坏记录必须报错，不能猜测其 kind 后忽略。Memory 精确路径不需要其它 Memory 内容有效；短 ID 则需读取全部候选，避免把未解析记录中的同 ID 隐藏。

精确引用读取目标和沿路径最近 README owner 边界。声明 Concord 格式的 frontmatter 必须严格解码；普通非 Concord frontmatter 保留 supporting page 语义。不允许把损坏 Concord owner 当成普通页面。最近 owner 的 kind 不支持附页时拒绝，不向更高祖先回退。精确目标验证受管来源、current disposition 与 placement；Use Case 还须验证其 feature 确实为当前 canonical Feature，路径符合归属；回归目标必须为 Problem。路径安全、目标类型和 anchor 校验均保留。

全局诊断 inventory 整体携带 documents、findings 与 complete，禁止用单独的 documents 数组默认声明完整。逐文件收集解码错误，保留错误路径与具名代码；关系 show 和 Web workspace 返回 complete 及全部相关完整性诊断，不把无关错误从完整性判断中滤掉。有效记录不是完整集合证明；所有 requireValidTrace 门禁同时检查 complete 和 findings，不能用部分图关闭 Problem、删除 Issue 或批准关系迁移。

## 访问模式

LocalRepository 增加显式 access: read/write。read 使用共享 snapshot 并拒绝真正发布；非 dry-run 的 write 使用独占 snapshot。dry-run 决定是否发布规划结果，与访问类别分开；预览沿用共享 snapshot，不授权真正发布。既有 dryRun 调用保留预览语义，不能因引入 access 而变成实际写入。

CLI 的全部普通查询必须声明 read；CLI action 与 Web 使用同一 action 分类。只有外部执行、恢复、cache rebuild/clear 和文档写操作使用 write。所有持久缓存句柄在 snapshot 结束前关闭；读取期间缓存更新不得成为获取独占发布锁的理由，无法安全使用缓存则回源。

## 共享加入与发布竞争

共享 token 加入现有目录后，在进入受保护读取前重新读取完整 owner 集合，确认自己的 token 存在且所有 owner 为同 worktree 的 shared。只有这一步成功才授权读取。若最后一个 reader 已离开且 writer 替换目录，加入者必须撤销自己的 token 并报告 Busy，不能开始读取。

writer 释放时精确核对并删除自己的 owner；短暂存在的合法 shared 加入记录不授予该 reader 读取权限，也不得使 writer 无法释放。未知文件、其它 exclusive token 或身份改变保留并拒绝。reader 在 writer 释放后验证成功的场景是安全的：它开始工作时目录已无 writer，自己的非空 token 阻止后续独占 rename。

owner 格式合法与临界区准入分开判断。同 worktree、同 host、最多一个 exclusive 加多个 shared 是合法加入暂态；多个 exclusive、未知文件或身份不符不是。若所有 owner 已确认 ESRCH，recover 可逐 token 回收该暂态；任何活 owner 均保留，不能把加入过程的双进程死亡变成永久不可恢复状态。

加入后的 fsync 或核验失败，清理准确的本次 token；清理失败保留具名错误和现场。禁止递归删除固定 lease 目录。恢复不以年龄推断死亡，host 不匹配、EPERM、PID 复用或未知 owner 仍保守拒绝。

## 恢复结果

recover 先记录并回收观察到的已死 publication token，再在独占保护下重新选择唯一 journal。统一入口的后续引擎阶段不再隐式回收；新到达的 owner（即使随后死亡）使本次调用 Busy，留待下一次显式恢复并记录。普通或 Trace 恢复完成后重新取得短快照核验当前 journal 与 runner；并发新发布可使最终核验 Busy，不能用早先结果宣称恢复完成。

返回 operation、原 journal 结果和 changedPaths，并增加 coordination，其中 publication 列出 reclaimedTokens，runner 区分 absent/running/blocked，blocked 带具名原因。无事务且 runner absent 或健康 running 时可返回 clean；不确定 runner 时返回 blocked，并保留 journal 实际处理结果。CLI 对 blocked 设置失败退出码，Web/action 保留相同状态字段。

初次独占检查已发现 runner blocked 时，不开始任何 journal 恢复；journalStatus 为 pending 或 clean，changedPaths 为空。统一入口保守保留 prepared 和 committed 现场，不通过重新解释各引擎的阶段增加清理权限。若初检可用，按现有普通、Trace 单文件或多文件恢复授权处理；之后 runner 变为 blocked 时保留已完成的 journalStatus，并将总 status 设为 blocked。最终核验直接使用 worktree 私有协调路径，不要求 init 回滚后仍有配置文件。多 journal 冲突先于 runner 报告，仍具名拒绝。

recover 不删除 runner.lease、run state、证据或未知文件。父 PID 死亡不能证明子进程清理完成；未获此证明前写操作仍拒绝。blocked 表示当前操作无法恢复完整写能力，不宣称 owner 文件损坏或证据已经无效之外的新事实。

## 当前文档的替代范围

采用后更新 docs/architecture.md、portable-coordination 功能契约、local-sdlc 架构及随包 recovery 指引。portable-publication 的历史裁决保留，并明确共享读取与操作范围已由本方案替代；不改写其历史选择或伪造 review 结果。

宪法 C-013 定义跨功能规则：操作按必要依赖验证，明确局部失败范围；全局诊断不得伪装完整性；存储、进程和信任边界的不确定性仍按实际共享资源阻断。开发状态允许局部不完整；新增及修改入口都须遵守。
