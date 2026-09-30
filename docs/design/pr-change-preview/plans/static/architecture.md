# 变更审阅与静态预览

本方案受 [C-001](../../../../constitution.md#c-001)、[C-002](../../../../constitution.md#c-002)、[C-003](../../../../constitution.md#c-003)、[C-004](../../../../constitution.md#c-004)、[C-005](../../../../constitution.md#c-005)、[C-007](../../../../constitution.md#c-007) 与 [C-014](../../../../constitution.md#c-014) 约束。

## 职责与取舍

本地工作台拥有当前工作树的读取与受管编辑。PR 预览是冻结提交的静态阅读产物，消费者拥有 Git 获取、PR 身份校验、托管及链接。二者共用文件树和 diff 阅读组件，分别取得当前 Git 状态或不可变提交差异。

公开托管本地服务会暴露仓库写入和执行权限，故不采用。为所有工作台操作维护一套离线 API 会扩大导出范围和校验负担，故静态预览只包含变更审阅。PR 产物不需要 Concord 项目配置有效，不运行消费者源码或配置，不建立持久缓存。

## 比较契约

`view export --base <ref> --head <ref> --base-label <label> --out <new-directory>` 必须给出 base，head 默认 HEAD；base-label 默认输入 base，只作展示。参数作为独立 Git argv 传递，先用 `rev-parse --verify --end-of-options <ref>^{commit}` 解析为完整 commit ID，再使用 ID 运算。拒绝 shallow 仓库。执行 `merge-base --all`，要求恰好一个最佳共同祖先。比较该祖先与 head，保留原始 base 身份。

冻结身份后，在受 Scope 管理的私有临时目录初始化空 bare Git 仓库，通过 alternate object directory 只读访问来源对象。临时仓库不复制来源 config、refs、index、info/attributes 或工作树，HEAD 不指向来源提交；清除继承 GIT 环境，禁用 global/system config、system attributes、replace refs、隐式 lazy fetch、提示与可选锁。

临时仓库没有 attributes；提交中的 .gitattributes 作为普通被审阅文件。明确使用 literal pathspec、no-ext-diff、no-textconv、ignore-submodules=none、submodule=short、固定 50% rename 阈值及 2000 rename limit，不检测 copies。来源 metadata 与 Git 可执行程序属于本地可信输入，不执行消费者脚本或配置。

以 NUL 分隔的 raw diff 枚举状态、完整对象 ID、模式与路径；路径必须是有效 UTF-8，否则 GitPathEncodingUnsupported。两侧内容按对象 ID 读取；普通文本的 patch 由两个 blob 的差异产生，显示路径由 entry 拥有，避免一个重命名路径与另一个新增文件混入同一差异。gitlink 仅显示 commit ID，symlink 仅显示 blob，不跟随目标。非 UTF-8 或含 NUL 正文视为二进制，不做有损转换。

最多 2000 entries，枚举 stdout 2 MiB，单个被比较 blob 4 MiB，读取前用 cat-file size 预检；两侧累计 blob 读取 64 MiB，单 patch 2 MiB、Markdown 每侧 1 MiB，最终 JSON 8 MiB。每个 Git 进程 stderr 64 KiB、stdout 有明确上限、超时 10 秒；导出总 deadline 120 秒。进程超限、超时或取消先终止并等待 close，必要时 SIGKILL，再释放临时目录。超限具名失败，不发布部分成功。大对象即使只有很小 patch 也拒绝。数据及静态资源各不超过 NiceEval 的 10 MiB 单文件上限。

## 产物与生命周期

Schema `concord.change-preview/v1` 由随包 `concord-sdlc/change-preview` 导出的 ChangePreviewSchema 和 decodeChangePreview 拥有。浏览器和 NiceEval 使用同一严格解码器，拒绝未知字段/版本，不另写格式定义。

| 字段 | 语义与约束 |
|---|---|
| format | 字面量 concord.change-preview/v1 |
| comparison | base、head、mergeBase 为同种 Git 对象格式的 40 或 64 位小写十六进制 ID；baseLabel 为非空纯文本，最多 256 字符 |
| entries | 最多 2000 项；path 唯一，是 head 路径，删除时是旧路径；UTF-8 仓库相对路径，无 NUL、空段、. 或 .. |
| entry.status | A、D、M、R、T；R 必须有 previousPath 且与 path 不同，其余不得有 previousPath |
| entry.before / after | null 表示该侧不存在；否则为 {oid, mode}，mode 仅 100644、100755、120000、160000；before 来自 mergeBase 的 previousPath 或 path，after 来自 head 的 path |
| entry.patch / binary | patch 是统一差异文本；binary 是布尔值，二进制不提供文本 patch；模式变化、无正文 rename、gitlink 也保留两侧对象信息 |
| entry.beforeMarkdown / afterMarkdown | 仅对应侧普通模式且路径后缀 .md/.markdown，文本非二进制时存在；空字符串是空正文，缺失表示不适用，不能与删除 null 混淆 |

A 的 before 必须 null，D 的 after 必须 null，其他两侧均存在；各 oid 长度与 comparison 一致。mode 序列化为字符串，例如 `{"oid":"0123456789012345678901234567890123456789","mode":"100644"}`。二进制的 patch 为空字符串；纯模式变化与内容不变的 rename 也可为空，UI 仍显示状态及 before/after。

文件布局固定为 index.html、changes.json 和构建器拥有的 assets/ 静态资源；资源清单由随包静态目录派生，拒绝 symlink。链接相对目录；hash query 拥有 path、view（unified/split）及 content（diff/before/after）。

只接受不存在的输出目录，拒绝 Git-private 路径、symlink 祖先与仓库根；父目录须存在。父目录及祖先属于调用者信任的本地文件系统，调用者不得授权不合作的同用户进程替换它们；本命令不是针对恶意本地同权限进程的沙箱。支持的并发是正常 Git/工作树编辑与其它导出：目标 mkdir 独占，已有目标拒绝，不覆盖其它导出。祖先检查不被描述为原子路径锁。

先完成读取、Schema 与预算检查，再非递归 mkdir 0700 创建输出。登记祖先和目标 dev/ino，并在每次文件创建前及发布后核对；每个文件用 wx 排他创建，HTML 最后，完成所有身份核对才返回成功。失败或取消保留整个不完整输出目录，报告路径，不删除文件、不重试覆盖；用户检查后显式选择新输出路径。保留而不自动清理避免误删同名同内容替换文件。临时 Git 目录在私有 0700 临时父目录内，不与输出共享所有权，由 Scope 回收。输出不包含凭据、工作树脏文件或 Git metadata；已提交内容属于显式导出范围。

浏览器只读取静态数据，不调用 `/api`，不提供 mutation。文本通过 React 转义；使用独立 ReactMarkdown 入口，不复用支持原始 HTML 或 p5 的本地 renderer。Markdown 跳过原始 HTML，不渲染图片，不加载远程资源；链接仅保留 https/http/mailto，禁用相对链接与其它协议。静态入口不依赖工作区 provider、扫描任务、HawDB 或服务进程。使用随包资源，在隔离安装后的 CLI 上验收。

## NiceEval 接入

NiceEval 的 Preview contribution 取得实际 PR base/head；必须 PR head = COMMIT_REF = checkout HEAD，merge checkout 不符合时拒绝，不偷偷切换候选。构建前取得 PR 身份，发布前再次查询；base ref/base SHA/head SHA 任一变化即失败。取得缺失对象并将 shallow 仓库补全由消费者负责，Concord 不联网。

静态产物放在 Preview 的 concord/ 子目录。清单生成前使用随包 decoder 核对 changes.json 的 base/head/baseLabel 与已验证输入，独立算出唯一最佳 merge-base 并比对。只允许该精确路径的 JSON 使用新 Schema，其它 JSON 规则不变。复用站点 10 MiB 单文件、64 MiB 总量和 256 文件门禁。产品入口提供相对 concord/ 链接；production 不查询 PR、不伪造比较。

工具包通过 NiceEval 仓库内固定 vendor tarball 安装，lockfile integrity 绑定字节。该包由本轮 Concord 的正式 build/pack 生成，CI 不依赖相邻源码或远端未发布版本。静态导出入口与 Schema 不加载原生缓存；本地完整工具仍使用原生平台产物。包更新必须重建并通过隔离安装验收，不手改 tarball 内容。

## 验收边界

隔离 Git 消费者构造目标分支独有提交、非 main PR head、脏 attributes、replace refs、子模块忽略配置、未提交脏文件及重命名。通过安装包 CLI 和导出的公共 decoder 验证身份、特殊路径、类型变化、二进制、模式与 Markdown；浏览器验证无脚本/图片执行、子路径、刷新和深链接。未初始化、无效配置及子目录启动均不加载消费者配置。

缺失对象、shallow、歧义 merge-base、非 UTF-8 路径、大对象小 patch、累计超限、输出冲突和 symlink 必须具名失败；失败保留未知输出，取消回收 Git 子进程与私有临时目录。同目标并发只能一份成功。NiceEval 正式入口验证真实 PR 输入适配、merge checkout 拒绝、PR 漂移、Schema/identity 与清单预算。`pnpm check` 验证构建与隔离安装；部署成功及远端链接仅由已授权的真实部署验收证明。
