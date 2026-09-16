# 文档模型与迁移

Research、Memory 和 Issue 的当前 owner 统一使用 `concord.document/v1`，类型与严格 Schema 由 `concord-sdlc/model` 导出。普通命令不解析旧 Memory、Feedback frontmatter，也不建立另一个历史列表。旧文件必须通过一次性迁移转换；迁移收据仅作审计，列表和关系发现不依赖收据。

Research owner 位于 `docs/research/<主题>/README.md`，可以嵌套；已有单文件通过离线工具移入同名目录并保留 ID。有独立问题和研究结论的页面成为 owner；纯导航、来源清单和执行收据保留为 supporting 页面。嵌套 owner 截断祖先归属。`observedAt` 表示原文明确的观察日期，可以缺省。使用 Git 首次记录时间填写 `createdAt` 时，必须保存 `createdAtSource`，不得将其描述为观察日期或实际创作日期。

Memory 在 `memory/<id>.md`。Problem、Decision、Insight 保存已明确的分类，Note 表示未分类笔记。`captured` 表示已经捕获但尚未确认当前生命周期；它适用于所有分类，Note 只允许这一状态。`memory activate --reason` 将已分类的 captured Problem 激活为 open，将 Decision／Insight 激活为 current，并追加历史。captured 不能用于 fixed 或 promotion。`superseded` 表示记录不再适用，Problem 也可处于此状态，绝不等价于修复。替代目标未知时保存原声明及来源，不生成虚构图边。

Resolution 的解决事实与证据核验分开表达：

| evidenceLevel | 含义 | 进入方式 |
| --- | --- | --- |
| `command` | Concord 命令的 red／green 收据 | 当前 open Problem 的严格 command gate |
| `author` | 非 fixed 的明确处理裁决 | 带原因的具名解决操作 |
| `attested` | 原记录已有的明确处理声明及来源 | 一次性迁移保留历史事实，始终未验证 |
| `repository` | Profile 核验正式收据后绑定到 Memory epoch 的结果 | 正式 gate；通用模式显示无法核验 |

Repository 证据保存原文件字节摘要、owner／contract／source 摘要、候选和八个 invocation 身份。六条 reliability 收据必须独立。epoch 表示 profile 在该 epoch 核验并绑定证据，不声称原 runner 在该 epoch 签发。candidate 仅表示 green 与 reliability 一致的候选，不据此宣称当前工作区已验证。reopen 增加 epoch 并保留完整旧 resolution；历史 invocation 不能被换路径后重复用于新解决。

Issue 在 `docs/issues/<id>.md`。`memoryRelations` 保存调查、根因、裁决和交付角色；`adoptions.current/history` 保存契约采用与退役；`closure` 保存明确处理理由和引用。远端 `source` 与本地 `origin` 分开，dev／dogfood 记录不伪造成 GitHub 来源。历史 fixed closure 保留原声明，但不会因此产生新执行证据。

通用模式、profile、离线迁移及恢复共享同一 Git-private `publication.lock`。从首次读取配置或 owner 起持锁，普通读取拒绝任何未完成的 publication journal。dry-run 不写用户文件或证据缓存，但可建立协调锁文件。写入不升级共享锁，恢复不覆盖未知编辑。

`scripts/migrate-documents.ts` 先产生仓库外的审阅计划，固定 HEAD、完整输入集合、摘要、输出和迁移收据。应用时在独占锁内重新核验，统一发布 owner 移动、正文和入口修改。多文件 journal 使用严格 `file | absent` 表达写入和删除；恢复先核验整个集合，再恢复任何文件。重复应用只核验已完成结果，漂移须生成新计划。旧 journal 具名拒绝。

迁移验收覆盖逐文件正文摘要、当前关系、历史、日期来源、CLI／浏览器实际发现以及中断恢复。它不证明 NiceEval 原生 E2E 覆盖或当前修复有效。

项目配置的当前入口是静态 `concord.config.ts`，通过 `concord-sdlc/config` 的 `ProjectConfig` 提供类型检查。普通命令发现旧 `concord.json` 时要求迁移，不执行旧配置。离线 `scripts/migrate-config.ts` 严格解码旧 JSON，保留配置值，生成实际 TS 字节，并通过共享 lease 与多文件 journal 成对创建新配置、删除旧配置。

```sh
pnpm exec tsx scripts/migrate-config.ts --root /absolute/consumer --plan /tmp/config-migration.json
pnpm exec tsx scripts/migrate-config.ts --apply --plan /tmp/config-migration.json
```

计划须保存在消费仓库外。应用前重新核对 HEAD、旧配置完整前像和新路径不存在；计划内的 TS 必须与旧 JSON 的严格转换结果一致。重复应用只接受旧文件已消失、新文件字节完全相同的结果。双配置、未知编辑或待恢复 journal 都会拒绝迁移，不猜测哪份配置应当获胜。旧收据不会因配置转换自动成为绑定新配置的有效证据。

发现历史 generic journal 时，两个离线迁移入口会在取得 lease 前拒绝，并保留事务文件、deadlock 与 publication lock 的存在性和权限。历史事务必须先独立、显式地离线恢复；本次脚本不恢复旧 journal，也不要求删除现场或循环运行普通 `concord recover`。

## 目录迁移

`scripts/migrate-document-packages.ts` 为缺少当前 metadata 的 Engineering、Roadmap、Design 生成显式分类，并将 Research 单文件移入目录。先在仓库外生成计划，独立核对清单和历史裁决，再应用：

```sh
pnpm exec tsx scripts/migrate-document-packages.ts --root /absolute/consumer --plan /tmp/document-packages.json
pnpm exec tsx scripts/migrate-document-packages.ts --apply --plan /tmp/document-packages.json
```

Research 不预设章节、日期、来源或附页。创建只需要 ID 和标题；附页可使用安全的相对路径，含子目录。Web 按物理主题目录分组，文件树包含主题内的嵌套 owner；选择它仍进入自身身份和关系。导航 README 不会自动成为 owner。

Roadmap 的 `cancelled` 必须有包含理由及原文来源的 `cancellation`，不能采用。Design 的 `deferral` 与 `decision` 互斥；历史选择未知时间时必须提供原文来源，不生成虚假日期。新的选择操作写入实际时间并清除暂缓状态。
