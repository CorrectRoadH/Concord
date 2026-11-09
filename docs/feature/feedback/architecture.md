# 身份、存储与接入边界

Feedback 是产品入口，本地 Issue `docs/issues/<id>.md` 是唯一 owner，不引入第二份反馈注册表。路径是 Issue 的身份，名称取自正文唯一的一级标题。反向关系由 Trace 推导。

## Issue 字段

frontmatter 只保存推导不出的字段，每个字段只在非空时出现：

```yaml
relations:
  - role: root-cause
    target: memory/token-race.md
source: {...}                    # FeedbackSource，见下文
```

| 角色 | 目标 | 含义 |
| --- | --- | --- |
| `investigation`、`root-cause` | Memory | 调查记录与根因 |
| `spec` | Feature、Use Case 或 Engineering 的路径或锚点 | 这个 Issue 涉及的 Spec：缺陷违反了它，缺口等它实现，或外部请求已写进它；不再涉及时删除这一项 |
| `related` | 另一个 Issue | 两个 Issue 相关，例如一个观察的缺陷由另一个 Issue 跟踪 |

同一角色与目标的关系只保存一次。`relations` 只接受本表中的角色：不符合的文件报告 `InvalidData`，错误给出文件路径、无效字段与允许的角色，不生成 Issue 记录，Concord 不改写这个文件。全局诊断与 Issue 索引保留其它有效记录与逐文件 finding，并返回 `complete: false`，不完整的结果不用于需要完整关系图的关闭裁决；精确读取这个文件失败，精确读取其它 Issue 不受影响。`spec` 只声明 Issue 涉及的 Spec，不声明问题类型、实现状态或测试覆盖。Issue 处理完就删除，见[关闭本地 Issue](use-case/manage-local-observations.md#close)；fixed 先按[修复核验](../local-sdlc/README.md#证据的范围)核验再删除。

`source` 是 FeedbackSource：GitHub 与 Linear 各一个分支，包含首次导入时的远端对象身份（见下文的去重键）、来源摘录、远端状态与时间，以及 `connectionId` 与 `importedAt`。没有 `source` 的 Issue 是 Local 来源。

Issue 文件可以直接编辑，`concord issue` 是写入同样内容并执行必要步骤的助手。`concord check` 校验当前字段。

## 远端来源

`concord.config.ts` 的 `feedbackConnections` 保存读取范围、环境变量名和绑定的远端范围 ID。GitHub 的仓库 ID 与 Linear 的组织/team UUID 在首次成功同步时与新反馈同批发布；后续不匹配会失败，重新绑定须明确修改配置。删除连接不删除反馈。

对象去重键与连接分开：GitHub 使用 API 实例与 REST issue ID；Linear 使用 API 实例、组织 UUID 和 issue UUID。仓库名称、team 选择器及人类可读编号可以改变，不能成为全局对象身份。GitHub GraphQL node ID 也不承担此 Spec。

远端观察快照是 `.git/concord/cache.hawdb` 中的可删除投影（worktree 中用 `git rev-parse --git-path concord` 定位）。缓存清除后保留 Markdown 中的首次摘录；重新同步恢复本次观察，不能声称知道远端历史上的最新版本。缓存的远端状态不替代本地状态或关闭结论。

读取流程是配置快照 → 无锁网络读取 → 提交时取得短期独占发布租约并校验配置摘要 → 原子发布绑定与新增反馈 → 更新缓存。文档已发布但缓存失败时返回成功及警告，重试不能重复导入。较旧远端版本不覆盖较新版本；同 updatedAt 内容冲突不静默择一。列表中缺席不表示删除。

API 适配器只访问固定 HTTPS API，重定向拒绝，外部 URL 只用于解析支持的对象定位符。所有分页、响应体、时间和条数有界；失败不发布已抓取的部分结果。连接失败不能证明对象被删除或其他连接无权读取。Linear 只使用个人 API key。

可选 GitHub CLI 模式的[接入设计](#gh-读取适配)采用不同的信任边界：认证与 HTTP 网络处理委托给受信 gh，Concord 控制初始请求、进程、输出预算、身份与发布，不声称能限制 CLI 内部重定向或网络缓冲。API 保持默认且不自动切换；项目配置显式选择 `transport: 'gh'`，要求 gh 通过适配器版本与 API 能力检查，并支持 POSIX 进程组。工作台操作者可触发服务端账号对配置范围的读取，不能把选择 CLI 当成浏览器认证。Linear CLI 仍为候选。

将来新增 provider 可实现同一读取与规范化 Spec；webhook 和 OAuth 回调需要另行定义权限、重试和资源归属。远端 Issue 写入不属于 Feedback 读取，见[远端 Issue 写入](../neutral-project-governance/use-case/mutate-remote-issue.md)。

`concord issue` 助手与 Web 保存使用单文件发布 journal（`concord recover` 恢复）；同步与导入把远端绑定与新增 Issue 在一次发布中写入。两条路径争用同一 `publication.lease`，不会并发发布。

## 来源并列与能力边界

| 来源 | 创建与读取 | 作者修改 | 删除 | 对外操作 |
| --- | --- | --- | --- | --- |
| Local | `concord new issue` 或直接创建文件 | 本地正文、状态与关系 | 直接删除文件；Web 只删除安全的本地 Issue | 无连接、无凭据、无同步 |
| GitHub | 显式导入或同步后读取 | 本地调查笔记与关系 | 不提供远端对象删除 | 只读 GitHub 来源 |
| Linear | 显式导入或同步后读取 | 本地调查笔记与关系 | 不提供远端对象删除 | 只读 Linear 来源 |

来源类型从现有 owner 的 source 派生，未声明 source 表示 Local；展示字段不是第二份持久登记表。远端连接配置仍只描述需要连接的 provider。Local 不实现假的同步接口，三种来源共享本地调查与关联能力，不假定全部来源拥有同样的外部权限。

Web 关闭 Issue 与 `issue close` 相同：仍有链接指向它时拒绝，否则删除文件。直接删除文件时，`check` 报告指向它的失效引用。详见[本地 Issue](use-case/manage-local-observations.md)。

## 反馈生命周期

没有关系的 Issue 显示「待处理」，带有任一关系显示「已关联」。展示状态从当前字段推导，不另存。

来源的 Open、Done、Closed 等状态只描述上一次远端观察，同步不关闭本地 Issue。本地处理完按[关闭本地 Issue](use-case/manage-local-observations.md#close)删除；fixed 删除前经过[修复核验](../local-sdlc/README.md#证据的范围)，结论写进提交说明。

来源摘录与本地笔记分开；用户对标题和正文的编辑不会被重复同步覆盖。远端移出列表、连接删除、缓存清空都不删除本地观察。多个反馈可指向同一个 Memory 或 Spec，无需按相似标题自动合并。

## 适配器

`feedback-schema.ts` 拥有浏览器与服务端共享的连接、来源与远端观察 Schema。`feedback-providers.ts` 负责 GitHub / Linear 协议、身份解析、范围校验和有界分页。`feedback.ts` 负责本地观察与幂等导入，`feedback-cache.ts` 负责可重建远端投影。

适配器的 `fetchFeedback(connection, options)` 返回 Effect，结果包含绑定后的连接、规范化条目及读取时间。可注入 transport 以模拟 HTTP 边界；该接口不会赋予 provider 修改项目文档的权限，也不持有[发布租约](../portable-coordination/concepts.md#publication-lease)。

连接 Schema 区分 API 与 GitHub gh：API 分支的 `transport` 省略或为 `api`，必须包含 `credentialEnv`；gh 分支必须显式指定 `transport: gh`，并拒绝 `credentialEnv`。transport 不进入远端对象去重键，适配器返回值不能自行修改连接的读取方式或目标范围。

显式 action `feedback.check` 接受已保存的连接 ID，仅支持 gh 连接；返回 `connectionId`、`provider: github`、`transport: gh`、`target` 与 `checkedAt`。检测不返回密钥、原始命令输出或账号清单，不发布远端绑定或缓存。Web 先完成当前设置草稿保存，再调用检测；旧结果不能回写新配置。

CLI 进程入口受 Scope 和服务进程的单槽约束，取消与关闭必须等待确定的清理结果。测试可替换外部进程边界，但不得替换 Concord 的资源所有权、响应规范化或本地发布来声称生命周期验收通过。详细预算及模式保证见 [gh 读取适配](#gh-读取适配)。

调用方只有在整个遍历成功后才能发布结果，不能把分页器返回的一部分条目当作完整同步。新增 provider 需给出稳定身份、范围绑定、凭据类型、限流与错误语义，并通过同样的幂等、失败与缓存验收。

## gh 读取适配

GitHub 连接可显式委托 gh 处理认证与网络，与 API 模式并列；Linear 只使用 API 连接。项目配置拥有启用来源及目标范围，gh 拥有个人认证状态；浏览器的登录环境不被当作服务进程的登录环境。用法与模式保证见 [CLI 与 Web 用法](cli.md#读取方式与保证)。

GitHub 可显式委托 gh 处理认证与网络，与 API 模式并列；两种模式的保证不同，必须分别公开。原生 CLI 的内部重定向与网络缓冲无法由外层 stdout 限额约束，Concord 不声称 gh 模式保留 API 模式的全部网络保证。Linear 不提供 CLI 配置选项。

新增 CLI 模式应是明确的配置分支，与当前环境变量 API 模式并列；不静默改写已有连接，不自动把已安装的同名程序视为支持的适配器。项目不得配置任意 executable、shell 或 argv。

GitHub 的读取入口是 `gh api`，要求 gh 通过适配器版本与 API 能力检查，并支持 POSIX 进程组。查询显式指定公共主机和仓库，继续使用 REST 仓库／issue ID、全部状态及 PR 排除规则。将来接入 Linear CLI 须由适配器声明可验收的版本范围与原生 `api` 命令，显式指定 workspace/team，保留组织、team 与 issue UUID。

### 来源与发布语义

配置快照、锁外读取、锁内摘要复核、稳定身份绑定、去重、原子发布和缓存刷新继续使用现有领域流程。任一页失败、身份不匹配或配置漂移均不发布部分反馈。更换 CLI 默认账号或 workspace 不能静默改变已绑定来源。停用或删除连接不删除本地反馈；远端读取不能修改本地调查结论。

CLI 模式只生成固定的只读请求，不执行远端写入、安装、登录或 token 导出命令。正常刷新不发起远端访问；同步与连接检测必须显式触发。状态应区分工具缺失、未登录、无目标权限、协议不兼容和读取失败，不把这些状态当成空反馈集合。

### 接入与信任约束

以下七项约束是 gh 模式的必要条件。

1. **模式和授权。**省略 transport 或 `transport: 'api'` 继续要求 `credentialEnv`。Concord 拒绝 HTTP 重定向并限制网络响应读取。GitHub 的 `transport: 'gh'` 禁止 `credentialEnv`，将认证、HTTP/TLS、内部重定向和网络缓冲委托给受信 gh。Concord 只保证固定初始只读请求与下面的输出、生命周期、身份和发布约束。两者不自动回退。工作台是受信操作入口：能访问并操作工作台的人可以触发服务器账号对配置范围的读取。选择 CLI 不构成浏览器用户身份认证。界面明确账号来自运行 Concord 的机器。
2. **可执行文件和配置。**从服务的受信启动环境解析 gh，排除空、相对、node_modules 及消费者仓库内的 PATH 条目；真实路径与 symlink 目标同样检查。整轮使用核验后的同一绝对可执行文件，无 shell、自动安装、下载 shim 或项目覆盖。独立临时 cwd 不位于仓库内；HOME、GH_CONFIG_DIR、XDG_CONFIG_HOME 仅来自启动环境，先解析绝对路径，不能随临时 cwd 改变含义。
3. **环境允许列表。**认证优先级为 GH_TOKEN、GITHUB_TOKEN、已保存凭据；只保留必要的系统 keyring 会话变量。强制非交互、无颜色、关闭更新通知与 `GH_TELEMETRY=false`。不传 GH_FORCE_TTY、debug、pager、Git 定位、endpoint 覆盖或运行时注入变量。网络设置只允许启动环境的 HTTP_PROXY、HTTPS_PROXY、NO_PROXY 及小写形式，以及受支持 gh 使用的 SSL_CERT_FILE、SSL_CERT_DIR；不接受项目或浏览器提供的环境，任何值都不进入诊断。
4. **预算和清理证明。**每轮创建 Effect Scope 拥有的进程服务；单次 stdout、stderr 和响应头合计最多 2 MiB，整轮 16 MiB、100 页、10,000 条。每次原始字节上限为单次与剩余额度的较小值；解码保留跨块 UTF-8。30 秒是读取截止时间，之后允许有界 TERM/grace/KILL 收尾。清理结果必须显式记录，包括取消路径；不能以活动计数归零代替清理成功。清理失败或未知禁止发布，并阻止继续启动 CLI 读取；不保留跨遍历的全部输出。
5. **生命周期。**同步与检测在服务进程共享一个槽位，清理完成才释放。Web 响应尚未完成时断连取消读取，正常请求体读完不触发取消。服务关闭先拒绝新调用，再取消读取，等待清理或已开始的发布，最后释放资源。发布前检查取消；进入现有不可中断事务后完成发布或保留 journal 恢复现场，不承诺该阶段在读取截止时间内完成。
6. **协议与身份。**固定 `gh api --hostname github.com --method GET` 请求模板，由 Concord 构造分页，不使用 CLI 自动分页或响应给出的任意 URL。逐条核验 issue URL 的 host、owner/repo 和编号对应请求范围；保留仓库 ID 绑定、REST 数字 ID、全部状态、PR 排除、CAS、去重和失败零部分发布。返回连接只允许补充绑定字段，必须比较 transport 等所有选择字段；切换 transport 不改变对象身份或丢失绑定。
7. **平台和版本。**在具有进程组清理实现的 POSIX 平台启用 gh 模式；其他平台返回具名能力缺失，本地反馈与 API 模式仍可用。最低 gh 版本须经离线帮助、对应源码及响应 fixture 核验后声明；版本字符串或退出码零不能单独证明协议兼容。连接检测只检查指定范围，不枚举账号、不提前绑定；普通刷新和保存设置不访问远端。

### 验收

测试只替换外部进程或 HTTP 边界，实际运行 Concord 的 Scope、规范化、发布和恢复流程。覆盖工具缺失、错误版本／协议、未登录、非零退出、恶意 stderr、部分分页失败、逐项身份错误、配置 CAS、切换 transport 去重，以及取消和关闭后无进程残留。补充跨块 UTF-8、累计字节上限、清理失败后的槽位隔离、路径／环境污染、正常请求结束不误取消、发布边界断连。

API 模式继续验收拒绝重定向和网络响应预算；CLI 模式不声称这些是 Concord 可控制的保证。构建与打包消费者运行 `bun run test`。真实登录态验收与受控假进程测试分别陈述；未经授权不访问实际账号，不用模拟通过声称真实接入已完成。

### 参考

- [GitHub REST issues](https://docs.github.com/en/rest/issues/issues)、[Linear GraphQL](https://linear.app/developers/graphql)、[Linear pagination](https://linear.app/developers/pagination) 与 [Linear rate limits](https://linear.app/developers/rate-limiting)：API 模式的协议依据。
- [GitHub CLI API](https://cli.github.com/manual/gh_api) 与 [认证状态](https://cli.github.com/manual/gh_auth_status)。
- [schpet/linear-cli 认证](https://github.com/schpet/linear-cli/blob/main/docs/authentication.md)：workspace、系统凭据存储和环境变量优先级。
- [Linear CLI 发版记录](https://github.com/schpet/linear-cli/releases)：v2 调整列表与 JSON 形状，并建议脚本使用原生 API 入口。
- [Linear CLI API 实现](https://github.com/schpet/linear-cli/blob/main/src/commands/api.ts)：单页和自动分页行为是接入验证的一部分，不能仅依据帮助文本推断预算与重定向保证。
