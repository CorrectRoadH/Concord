# CLI 登录态复用：接入设计

本方案定义可选 GitHub CLI 读取模式，与默认 API 连接并列；Linear 继续使用 API 连接。适用宪法：[单一来源](../../constitution.md#c-001)、[独立运行](../../constitution.md#c-002)、[受管写入](../../constitution.md#c-003)、[严格边界](../../constitution.md#c-005)、[授权与独立挑战](../../constitution.md#c-007)。视觉规则由根目录 `DESIGN.md` 拥有。

## 目标

在项目设置选择反馈来源，复用 Concord 服务所在机器已登录的 CLI，不要求维护者在 Concord 再提供一份凭据。项目配置拥有启用来源及目标范围，CLI 拥有个人认证状态；浏览器的登录环境不被误认为服务进程的登录环境。本地反馈不依赖任一外部 CLI。

## 候选与取舍

| 方案 | 收益 | 需要证明的边界 |
| --- | --- | --- |
| GitHub 与 Linear 均采用 CLI 原生 API 命令 | 两种来源复用登录态，Concord 不导出密钥 | 固定主机、身份、重定向、分页、预算及进程清理均不能退化 |
| 先采用 GitHub CLI，Linear 继续使用当前 API 连接 | 缩小首轮接入范围 | GitHub 同样需要完整边界证明；Linear 不得显示为已支持 CLI |
| 从 CLI 导出 token，再用现有 HTTP 适配器 | 可继续控制 HTTP 读取 | Concord 重新接触密钥，不满足本方案减少凭据接触的目标，不作为优先方案 |
| 明确委托 GitHub CLI 处理认证与网络，保留 API 模式 | 复用 gh 登录态，保持已有连接行为 | 必须公开两种模式的不同保证，并验证进程、输出、身份和发布边界 |

选择第四种方案。原生 CLI 的内部重定向和网络缓冲无法通过外层 stdout 限额约束，因此不采用“换成 CLI 后全部网络保证不变”的方案。此方案经独立只读挑战给出 CONDITIONAL；以下七项约束是实现的必要条件，不能由实现者省略。Linear CLI 仅保留候选，不提供已支持的配置选项。

新增 CLI 模式应是明确的配置分支，与当前环境变量 API 模式并列；不静默改写已有连接，不自动把已安装的同名程序视为支持的适配器。项目不得配置任意 executable、shell 或 argv。

GitHub 的读取入口是 `gh api`，要求 gh 2.98.0 或更新版本及 POSIX 进程组能力。查询显式指定公共主机和仓库，继续使用 REST 仓库／issue ID、全部状态及 PR 排除规则。Linear 的候选实现明确为社区项目 `schpet/linear-cli`，不是所有名为 `linear` 的工具；需固定可验收的版本和原生 `api` 命令契约，显式指定 workspace/team，保留组织、team 与 issue UUID。

## 不变的来源与发布语义

配置快照、锁外读取、锁内摘要复核、稳定身份绑定、去重、原子发布和缓存刷新继续使用现有领域流程。任一页失败、身份不匹配或配置漂移均不发布部分反馈。更换 CLI 默认账号或 workspace 不能静默改变已绑定来源。停用或删除连接不删除本地反馈；远端读取不能修改本地调查结论。

CLI 模式只生成固定的只读请求，不执行远端写入、安装、登录或 token 导出命令。正常刷新不发起远端访问；同步与连接检测必须显式触发。状态应区分工具缺失、未登录、无目标权限、协议不兼容和读取失败，不把这些状态当成空反馈集合。

## 接入与信任契约

1. **模式和授权。**缺省或 `transport: 'api'` 继续要求 `credentialEnv`，由 Concord 拒绝 HTTP 重定向并限制网络响应读取；GitHub 的 `transport: 'gh'` 禁止 `credentialEnv`，将认证及 HTTP/TLS、内部重定向和网络缓冲委托给受信 gh。Concord 只保证固定初始只读请求与下面的输出、生命周期、身份和发布约束。两者不自动回退。工作台是受信操作入口：能访问并操作工作台的人可以触发服务器账号对配置范围的读取，选择 CLI 不构成浏览器用户身份认证。界面明确账号来自运行 Concord 的机器。
2. **可执行文件和配置。**从服务的受信启动环境解析 gh，排除空、相对、node_modules 及消费者仓库内的 PATH 条目；真实路径与 symlink 目标同样检查。整轮使用核验后的同一绝对可执行文件，无 shell、自动安装、下载 shim 或项目覆盖。独立临时 cwd 不位于仓库内；HOME、GH_CONFIG_DIR、XDG_CONFIG_HOME 仅来自启动环境，先解析绝对路径，不能随临时 cwd 改变含义。
3. **环境允许列表。**认证优先级为 GH_TOKEN、GITHUB_TOKEN、已保存凭据；只保留必要的系统 keyring 会话变量。强制非交互、无颜色、关闭更新通知与 `GH_TELEMETRY=false`。不传 GH_FORCE_TTY、debug、pager、Git 定位、endpoint 覆盖或运行时注入变量。网络设置只允许启动环境的 HTTP_PROXY、HTTPS_PROXY、NO_PROXY 及小写形式，以及受支持 gh 使用的 SSL_CERT_FILE、SSL_CERT_DIR；不接受项目或浏览器提供的环境，任何值都不进入诊断。
4. **预算和清理证明。**每轮创建 Effect Scope 拥有的进程服务；单次 stdout、stderr 和响应头合计最多 2 MiB，整轮 16 MiB、100 页、10,000 条。每次原始字节上限为单次与剩余额度的较小值；解码保留跨块 UTF-8。30 秒是读取截止时间，之后允许有界 TERM/grace/KILL 收尾。清理结果必须显式记录，包括取消路径；不能以活动计数归零代替清理成功。清理失败或未知禁止发布，并阻止继续启动 CLI 读取；不保留跨遍历的全部输出。
5. **生命周期。**同步与检测在服务进程共享一个槽位，清理完成才释放。Web 响应尚未完成时断连取消读取，正常请求体读完不触发取消。服务关闭先拒绝新调用，再取消读取，等待清理或已开始的发布，最后释放资源。发布前检查取消；进入现有不可中断事务后完成发布或保留 journal 恢复现场，不承诺该阶段在读取截止时间内完成。
6. **协议与身份。**固定 `gh api --hostname github.com --method GET` 请求模板，由 Concord 构造分页，不使用 CLI 自动分页或响应给出的任意 URL。逐条核验 issue URL 的 host、owner/repo 和编号对应请求范围；保留仓库 ID 绑定、REST 数字 ID、全部状态、PR 排除、CAS、去重和失败零部分发布。返回连接只允许补充绑定字段，必须比较 transport 等所有选择字段；切换 transport 不改变对象身份或丢失绑定。
7. **平台和版本。**在具有进程组清理实现的 POSIX 平台启用 gh 模式；其他平台返回具名能力缺失，本地反馈与 API 模式仍可用。最低 gh 版本须经离线帮助、对应源码及响应 fixture 核验后声明；版本字符串或退出码零不能单独证明协议兼容。连接检测只检查指定范围，不枚举账号、不提前绑定；普通刷新和保存设置不访问远端。

## 实现验收

测试只替换外部进程或 HTTP 边界，实际运行 Concord 的 Scope、规范化、发布和恢复流程。覆盖工具缺失、错误版本／协议、未登录、非零退出、恶意 stderr、部分分页失败、逐项身份错误、配置 CAS、切换 transport 去重，以及取消和关闭后无进程残留。补充跨块 UTF-8、累计字节上限、清理失败后的槽位隔离、路径／环境污染、正常请求结束不误取消、发布边界断连。

API 模式继续验收拒绝重定向和网络响应预算；CLI 模式不声称这些是 Concord 可控制的保证。构建与打包消费者运行 `pnpm check`。真实登录态验收与受控假进程测试分别陈述；未经授权不访问实际账号，不用模拟通过声称真实接入已完成。

## 来源

- [GitHub CLI API](https://cli.github.com/manual/gh_api) 与 [认证状态](https://cli.github.com/manual/gh_auth_status)。
- [schpet/linear-cli 认证](https://github.com/schpet/linear-cli/blob/main/docs/authentication.md)：workspace、系统凭据存储和环境变量优先级。
- [Linear CLI 发布记录](https://github.com/schpet/linear-cli/releases)：v2 调整列表与 JSON 形状，并建议脚本使用原生 API 入口。
- [Linear CLI API 实现](https://github.com/schpet/linear-cli/blob/main/src/commands/api.ts)：单页和自动分页行为是接入验证的一部分，不能仅依据帮助文本推断预算与重定向保证。
