# 身份、存储与接入边界

Feedback 是产品入口，已有 `kind: issue` 的本地观察继续拥有 `docs/issues/<id>.md`，不引入第二份反馈注册表。其可选 `source` 保存首次导入的远端身份、摘录、状态、时间和连接来源；`memories`、`features` 保存正向关系。反向关系由 Trace 推导。

`concord.config.ts` 的 `feedbackConnections` 保存读取范围、环境变量名和绑定的远端范围 ID。GitHub 的仓库 ID 与 Linear 的组织/team UUID 在首次成功同步时与新反馈同批发布；后续不匹配会失败，重新绑定须明确修改配置。删除连接不删除反馈。

对象去重键与连接分开：GitHub 使用 API 实例与 REST issue ID；Linear 使用 API 实例、组织 UUID 和 issue UUID。仓库名称、team 选择器及人类可读编号可以改变，不能成为全局对象身份。GitHub GraphQL node ID 也不承担此契约。

远端观察快照是 `.git/concord/cache.hawdb` 中的可删除投影（worktree 中用 `git rev-parse --git-path concord` 定位）。缓存清除后保留 Markdown 中的首次摘录；重新同步恢复本次观察，不能声称知道远端历史上的最新版本。缓存的远端状态永远不替代本地状态或 Memory 证据。

读取流程是配置快照 → 锁外网络 → 重新取得仓库锁并校验配置摘要 → 原子发布绑定与新增反馈 → 更新缓存。文档已发布但缓存失败时返回成功及警告，重试不能重复导入。较旧远端版本不覆盖较新版本；同 updatedAt 内容冲突不静默择一。列表中缺席不表示删除。

当前 API 适配器只访问固定 HTTPS API，重定向拒绝，外部 URL 只用于解析支持的对象定位符。所有分页、响应体、时间和条数有界；失败不发布已抓取的部分结果。连接失败不能证明对象被删除或其他连接无权读取。Linear 首版明确只使用个人 API key。

可选 GitHub CLI 模式的[接入设计](cli-integration.md)采用不同的信任边界：认证与 HTTP 网络处理委托给受信 gh，Concord 控制初始请求、进程、输出预算、身份与发布，不声称能限制 CLI 内部重定向或网络缓冲。API 保持默认且不自动切换；项目配置显式选择 `transport: 'gh'`，要求 gh 2.98.0 或更新版本及 POSIX 进程组能力。工作台操作者可触发服务端账号对配置范围的读取，不能把选择 CLI 当成浏览器认证。Linear CLI 仍为候选。

设计经过独立只读挑战后定案。将来新增 provider 可实现同一读取与规范化契约；远端写入、webhook 和 OAuth 回调需要另行定义权限、重试和资源归属。


## 来源并列与能力边界

| 来源 | 创建与读取 | 作者修改 | 删除 | 对外操作 |
| --- | --- | --- | --- | --- |
| Local | 本地 create、index、recall | 本地正文与关系 | 仅无来源、无关系、无历史的 draft | 无连接、无凭据、无同步 |
| GitHub | 显式导入或同步后读取 | 本地调查笔记与关系 | 本轮不提供远端对象删除 | 只读 GitHub 来源 |
| Linear | 显式导入或同步后读取 | 本地调查笔记与关系 | 本轮不提供远端对象删除 | 只读 Linear 来源 |

来源类型从现有 owner 的 source 派生，缺省表示 Local；展示字段不是第二份持久登记表。远端连接配置仍只描述需要连接的 provider。Local 不实现假的同步接口，三种来源共享本地调查与关联能力，不假定全部来源拥有同样的外部权限。

安全本地删除通过同一文档事务发布 after:null，要求当前完整摘要与合法关系图；任何入边、历史或已建立调查关联都阻止删除。详见[本地观察契约](use-case/manage-local-observations.md)。
