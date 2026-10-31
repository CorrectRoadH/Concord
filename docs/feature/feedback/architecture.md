# 身份、存储与接入边界

Feedback 是产品入口，本地 Issue `docs/issues/<id>.md` 是唯一 owner，不引入第二份反馈注册表。路径是 Issue 的身份，名称取自正文唯一的一级标题。反向关系由 Trace 推导。

## Issue 字段

frontmatter 只保存推导不出的字段，每个字段只在非空时出现：

```yaml
status: open                     # open 或 closed
relations:
  - role: root-cause
    target: memory/token-race.md
source: {...}                    # FeedbackSource，见下文
closure:
  kind: fixed
  reason: 修正锁顺序
  verification: {...}            # 仅 fixed
```

| 角色 | 目标 | 含义 |
| --- | --- | --- |
| `investigation`、`root-cause`、`decision` | current 或 superseded 的 Memory | 调查记录、根因、所依据的决策 |
| `adopts` | Feature、Use Case 或 Engineering 的路径或锚点 | 该 Issue 当前被这条 Spec 承接；退役即删除这一项，历史在 Git |
| `related` | 另一个 Issue | 两个 Issue 相关，例如一个观察的缺陷由另一个 Issue 跟踪 |

同一角色与目标的关系只保存一次。`closure` 各种类的必需字段与写入规则见[本地观察](use-case/manage-local-observations.md#操作-spec)；fixed 的 `verification` 按[修复核验](../local-sdlc/scope.md#证据的范围)写入。

`source` 是 FeedbackSource：GitHub 与 Linear 各一个分支，包含首次导入时的远端对象身份（见下文的去重键）、来源摘录、远端状态与时间，以及 `connectionId` 与 `importedAt`。没有 `source` 的 Issue 是 Local 来源。

Issue 文件可以直接编辑，`concord issue` 是写入同样内容并执行必要步骤的助手。`concord check` 校验当前字段与关闭结论。

## 远端来源

`concord.config.ts` 的 `feedbackConnections` 保存读取范围、环境变量名和绑定的远端范围 ID。GitHub 的仓库 ID 与 Linear 的组织/team UUID 在首次成功同步时与新反馈同批发布；后续不匹配会失败，重新绑定须明确修改配置。删除连接不删除反馈。

对象去重键与连接分开：GitHub 使用 API 实例与 REST issue ID；Linear 使用 API 实例、组织 UUID 和 issue UUID。仓库名称、team 选择器及人类可读编号可以改变，不能成为全局对象身份。GitHub GraphQL node ID 也不承担此 Spec。

远端观察快照是 `.git/concord/cache.hawdb` 中的可删除投影（worktree 中用 `git rev-parse --git-path concord` 定位）。缓存清除后保留 Markdown 中的首次摘录；重新同步恢复本次观察，不能声称知道远端历史上的最新版本。缓存的远端状态不替代本地状态或关闭结论。

读取流程是配置快照 → 无锁网络读取 → 提交时取得短期独占发布租约并校验配置摘要 → 原子发布绑定与新增反馈 → 更新缓存。文档已发布但缓存失败时返回成功及警告，重试不能重复导入。较旧远端版本不覆盖较新版本；同 updatedAt 内容冲突不静默择一。列表中缺席不表示删除。

API 适配器只访问固定 HTTPS API，重定向拒绝，外部 URL 只用于解析支持的对象定位符。所有分页、响应体、时间和条数有界；失败不发布已抓取的部分结果。连接失败不能证明对象被删除或其他连接无权读取。Linear 只使用个人 API key。

可选 GitHub CLI 模式的[接入设计](cli-integration.md)采用不同的信任边界：认证与 HTTP 网络处理委托给受信 gh，Concord 控制初始请求、进程、输出预算、身份与发布，不声称能限制 CLI 内部重定向或网络缓冲。API 保持默认且不自动切换；项目配置显式选择 `transport: 'gh'`，要求 gh 2.98.0 或更新版本及 POSIX 进程组能力。工作台操作者可触发服务端账号对配置范围的读取，不能把选择 CLI 当成浏览器认证。Linear CLI 仍为候选。

将来新增 provider 可实现同一读取与规范化 Spec；webhook 和 OAuth 回调需要另行定义权限、重试和资源归属。远端 Issue 写入不属于 Feedback 读取，见[远端 Issue 写入](../neutral-project-governance/use-case/mutate-remote-issue.md)。

`concord issue` 助手与 Web 保存使用单文件发布 journal（`concord recover` 恢复）；同步与导入把远端绑定与新增 Issue 在一次发布中写入。两条路径争用同一 `publication.lease`，不会并发发布。

## 来源并列与能力边界

| 来源 | 创建与读取 | 作者修改 | 删除 | 对外操作 |
| --- | --- | --- | --- | --- |
| Local | `concord new issue` 或直接创建文件 | 本地正文、状态与关系 | 直接删除文件；Web 只删除安全的本地 Issue | 无连接、无凭据、无同步 |
| GitHub | 显式导入或同步后读取 | 本地调查笔记与关系 | 不提供远端对象删除 | 只读 GitHub 来源 |
| Linear | 显式导入或同步后读取 | 本地调查笔记与关系 | 不提供远端对象删除 | 只读 Linear 来源 |

来源类型从现有 owner 的 source 派生，未声明 source 表示 Local；展示字段不是第二份持久登记表。远端连接配置仍只描述需要连接的 provider。Local 不实现假的同步接口，三种来源共享本地调查与关联能力，不假定全部来源拥有同样的外部权限。

Web 的安全本地删除通过同一文档事务发布 after:null，要求当前完整摘要与合法关系图；任何入边、关系或关闭结论都阻止删除。直接删除文件时，`check` 报告指向它的失效引用。详见[本地观察 Spec](use-case/manage-local-observations.md)。

## 反馈生命周期

`status: open` 且没有关系的 Issue 显示「待处理」；带有任一关系显示「已关联」；`status: closed` 显示「已关闭」。这三个展示状态从当前字段推导，不额外持久化一份 triage 字段。

来源的 Open、Done、Closed 等状态只描述上一次远端观察，同步不关闭本地 Issue。本地关闭按[关闭种类](use-case/manage-local-observations.md#操作-spec)写入结论；fixed 关闭前经过[修复核验](../local-sdlc/scope.md#证据的范围)，结论写入 `closure.verification`。

来源摘录与本地笔记分开；用户对标题和正文的编辑不会被重复同步覆盖。远端移出列表、连接删除、缓存清空都不删除本地观察。多个反馈可指向同一个 Memory 或 Spec，无需按相似标题自动合并。
