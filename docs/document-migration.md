# 文档模型与格式边界

Research、Memory 和 Issue 的当前 owner 统一使用 `concord.document/v1`，类型与严格 Schema 由 `concord-sdlc/model` 导出。输入只按当前 Schema 严格解码，不提供兼容读取或格式转换入口。无法识别的受管输入产生诊断，保留原文件；列表和关系从当前 owner 派生。

Research owner 位于 `docs/research/<主题>/README.md`，可以嵌套。有独立问题和研究结论的页面成为 owner；纯导航、来源清单和执行收据保留为 supporting 页面。嵌套 owner 截断祖先归属。`observedAt` 表示原文明确的观察日期，可以省略。使用 Git 首次记录时间填写 `createdAt` 时，必须保存 `createdAtSource`，不得将其描述为观察日期或实际创作日期。

Memory 在 `memory/<id>.md`。Problem、Decision、Insight 保存已明确的分类，Note 表示未分类笔记。`captured` 表示已经捕获但尚未确认当前生命周期；它适用于所有分类，Note 只允许这一状态。`memory activate --reason` 将已分类的 captured Problem 激活为 open，将 Decision／Insight 激活为 current，并追加历史。captured 不能用于 fixed 或 promotion。`superseded` 表示记录不再适用，Problem 也可处于此状态，绝不等价于修复。替代目标未知时保存原声明及来源，不生成虚构图边。

Resolution 的解决事实与证据核验分开表达：

| evidenceLevel | 含义 | 进入方式 |
| --- | --- | --- |
| `command` | Concord 命令的 red／green 收据 | 当前 open Problem 的严格 command gate |
| `author` | 非 fixed 的明确处理裁决 | 带原因的具名解决操作 |
| `attested` | 原记录已有的明确处理声明及来源 | 已有历史声明，始终未验证，不产生当前证明 |
| `repository` | Profile 核验正式收据后绑定到 Memory epoch 的结果 | 正式 gate；通用模式显示无法核验 |

Repository 证据保存原文件字节摘要、owner／contract／source 摘要、候选和八个 invocation 身份。六条 reliability 收据必须独立。epoch 表示 profile 在该 epoch 核验并绑定证据，不声称原 runner 在该 epoch 签发。candidate 仅表示 green 与 reliability 一致的候选，不据此宣称当前工作区已验证。reopen 增加 epoch 并保留完整旧 resolution；历史 invocation 不能被换路径后重复用于新解决。

Issue 在 `docs/issues/<id>.md`。`memoryRelations` 保存调查、根因、裁决和交付角色；`adoptions.current/history` 保存契约采用与退役；`closure` 保存明确处理理由和引用。远端 `source` 与本地 `origin` 分开，dev／dogfood 记录不伪造成 GitHub 来源。历史 fixed closure 保留原声明，但不会因此产生新执行证据。

发布与恢复使用 Git-private 的短 publication lease 和当前 journal 协议。读取使用共享快照，实际发布使用独占快照；dry-run 不发布文件，实际执行仍须重新校验。未知格式或不完整事务保留现场并具名拒绝，恢复使用与现场匹配的工具版本。

项目配置使用静态 concord.config.ts。Schema、配置原文和摘要共同确定当前输入身份；不支持的配置不被读取为当前授权。

Research 不预设章节、日期、来源或附页。创建只需要 ID 和标题；附页可使用安全的相对路径，含子目录。Web 按物理主题目录分组，文件树包含主题内的嵌套 owner；选择它仍进入自身身份和关系。导航 README 不会自动成为 owner。

Roadmap 的 `cancelled` 必须有包含理由及原文来源的 `cancellation`，不能采用。Design 的 `deferral` 与 `decision` 互斥；历史选择未知时间时必须提供原文来源，不生成虚假日期。新的选择操作写入实际时间并清除暂缓状态。
