# 架构

## 编译管线

Concord 从严格 YAML frontmatter 的 Markdown owner、TypeScript AST 可识别的代码声明，以及测试根里的 Concord 标记读取事实，解析 canonical path 与 anchor，验证目标类型、重复关系和循环，再生成 trace、review 与检查结果。测试标记不解析宿主测试语法。sourceRoots 与 testRoots 分别控制实现和测试扫描；代码声明解析可按文件命中可删除 HawDB 投影，键含 worktree、解析器版本、路径和字节摘要；归属和关系不缓存，始终用当前 Markdown 重算。测试投影仍按整次扫描键缓存。命中都严格解码。

## 自举

本项目的实现文件与关键函数直接声明各自的 Feature / Use Case。共享基础模块关联 Feature，具体行为关联八条 Use Case；repository profile 路由和注释渲染使用显式 region。selfhost 验收要求每条 Use Case 都存在真实实现和测试关联，源码旁的声明仍是唯一 owner，不另存模块到功能的映射表。

## 执行管线

只有 `test run` 启动仓库命令。runner argv 逐参数替换 `{file}`、`{name}`、`{pattern}`，不经过 shell；timeout、取消和输出上限都由受 Scope 管理的进程组清理。收据记录 command outcome 与 observed execution，未知或全跳过不会被包装成 case passed。

## 写入管线

文档 mutation 先解析完整变更集和 preimage，再持久化 journal，以同文件系统临时文件和原子 rename 发布。读取发现未完成 journal 时要求显式 recover；内容既不匹配 preimage 也不匹配 planned digest 时拒绝覆盖外部编辑。

## 信任边界

仓库作者负责 runner 命令及 sourceFiles 声明。摘要能发现声明范围内的漂移，但不证明忽略依赖、外部服务、完整环境或断言充分性。工具不自动触碰生产、远端或凭据。

## 操作依赖

Repository 负责安全读取、配置身份、依赖观察和发布。文档模块决定哪些路径参与当前操作。全局诊断与局部查询共用严格 decoder。局部查询按命令依赖取 owner；全局诊断逐文件保留错误，并传播 `complete: false`。

| 操作 | 内容依赖 | 协调 | 失败范围 |
| --- | --- | --- | --- |
| memory/issue list、index、recall、search | 相应来源内全部候选 owner | 共享 snapshot | 范围内坏记录、来源缺失、配置或事务障碍 |
| memory/issue edit 的 canonical path | 指定 owner 与当前摘要 | 独占 publication | 目标或其授权依赖、写入资源障碍 |
| memory/issue edit 的短 ID | 相应类别的来源集合及唯一匹配 owner | 独占 publication | 集合不完整、歧义或写入资源障碍 |
| memory/issue create | 目标路径、写来源权限；Issue 的同类 ID 集合；Problem 的证据政策 | 独占 publication | 身份冲突、必要依赖或写入资源障碍 |
| code/test annotate | 每个指定 canonical reference、归属链、类型、anchor；显式 regression Problem | 共享 snapshot | 指定依赖缺陷，不加载全局 Trace |
| show、trace、review | 展示的关系图 | 共享 snapshot | 输出 findings；需要完整图的结论拒绝不完整输入 |
| check | 全仓库事实与关联 | 共享 snapshot | 各 owner 解析错误累计为 findings，`ok: false` |
| fixed、关系变更、删除 | 当前证明与保证关系完整所需的集合 | 独占 publication | 保留现有严格身份、证据下限和逆向关系要求 |

集合查询先按物理来源限定路径，再解码。Feature 与 Use Case 共用物理根时，同根候选中的坏记录必须报错。Memory 精确路径不需要其它 Memory 内容有效。短 ID 读取全部候选，避免隐藏未解码记录中的同 ID。文件名不推导作者 ID。来源扫描按当前配置和安全目录读取。

精确引用读取目标和沿路径最近的 README owner 边界。声明 Concord 格式的 frontmatter 必须严格解码。普通非 Concord frontmatter 保留 supporting page 语义。损坏的 Concord owner 不能当作普通页面。最近 owner 的 kind 不支持附页时拒绝，不向更高祖先回退。精确目标验证受管来源、current disposition 与 placement。Use Case 还须验证其 feature 为当前 canonical Feature，且路径符合归属。回归目标必须为 Problem。路径安全、目标类型和 anchor 校验保留。

## 完整性诊断

全局诊断 inventory 同时携带 documents、findings 与 complete。单独的 documents 数组不表示集合完整。逐文件收集解码错误，保留错误路径与具名代码，并传播 `complete: false`。关系 show 和 Web workspace 返回 complete 及全部相关完整性诊断。有效记录不能单独证明集合完整。requireValidTrace 同时检查 complete 和 findings。部分图不能关闭 Problem、删除 Issue 或批准关系迁移。

未完成的多文件 journal 仍阻断普通快照。局部解析隔离仍使用 publication lease，并在未完成 journal 前停止。读写 access 与 dryRun 的分离、共享加入复核和恢复结果见[可移植协调架构](../portable-coordination/architecture.md)。跨功能规则见 [c-013](../../constitution.md#c-013)。
