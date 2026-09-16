# Repository profile

Concord 的通用模式和 repository profile 都使用 `concord.project/v1`、`concord.document/v1` Markdown、测试注释和各自的 evidence 契约。`concord repo` 运行消费仓库明确选择的 profile，但不再解析或生成 NiceEval 旧 node frontmatter 文档。

NiceEval 的领域实现由 Concord 的 `repository/` 拥有，编译产物从 `concord-sdlc/repository/*` 导出。NiceEval 原路径仅保留转出声明供既有源码链接定位，实际实现不在本地重复维护。根脚本保留 `pnpm run repo`、`pnpm memory`、`pnpm pr:body` 等名字和参数。

消费仓库根目录的 `concord.repository.json` 声明 `format: concord.repository/v1` 和一个 canonical `host` 路径。host 默认导出 `concord.repository-host/v1`、`caseIdentity: "concord.case-contracts/v1"`、真实 runner root 与正式 inventory/evidence APIs。它是本地作者维护的可信代码，仅在显式 repository profile 中加载；通用 help 不加载它。

执行前核对 Git 顶层、host root，以及当前执行 engine 与消费者锁定安装包的实际文件摘要。全局 engine 字节不同会返回 `RepositoryEngineMismatch`，应改用仓库锁定的 `pnpm run repo`。摘要包括实际 engine 和包依赖锁，不依赖版本号或 host 自报。

NiceEval 的 candidate、Testkit、原生 collection、正式 red/green/takeover 和 owned process 仍由自身 E2E runner 拥有。Concord 不把 command 收据转换为 formal evidence。私有 bundle 的实现身份改变后按原协议重新签发；旧 v1 receipts、证据索引与 fixed Memory 保留为历史，不重写数据；新 fixed 必须使用 v2 formal evidence。

设计经过独立只读挑战并获 PASS。切换和发布验收包括：安装后真实最小 inventory、所有根入口 help、隔离写入及失败清理、身份不匹配与 command proof 拒绝、读取基线对照，以及两个项目的必需检查。未重跑完整 formal red/green/takeover 时不声称其正向验收完成。

## 当前关系与历史

真实测试声明紧邻的 `@feature` 或 `@use-case` 绑定 canonical 契约；标题不携带身份。`@regression`、`@issue`、`@test-file` 与 `@status` 保存测试元数据。测试身份由 `deriveTestReference` 自动生成 `neref_...`，AST 只定位注释，inventory 仍由原生 collection 见证。

首次接入直接在真实声明旁写 `@feature` 或 `@use-case`；无需分配人工 ID，也无需先创建 testing owner 或执行 attach。缺失或非法 canonical 契约路径返回具名错误。

host 须在实际执行副本中将 native case 与源码声明唯一绑定，使用可靠位置或等效的可验证关联；裸标题和 test-file 均不能单独证明绑定，缺失、重复和动态歧义拒绝。host 的实现摘要必须覆盖绑定算法及身份 codec；能力字段仅是受信任契约，不证明该算法正确。Concord 不改造或代签 native receipts。设计与验收依据见[注释身份裁决](design/annotation-case-identity/README.md)。

source、helper、归档和 evidence index 的变化共享 journal 与完整 preimage CAS。刷新已有 regression 的旧版或陈旧 proof 使用显式 `regression refresh --reason`，要求 open Problem 和新受管 v2 evidence；归档旧索引指针，不改写旧 receipts 或重复追加 relation。

源码身份使用 `concord.repository-source-identity/v3` 的 `direct-contract` binding，投影使用 `concord.repository-source-projection/v2`。迁移后旧证据按原规则陈旧，保留原件并重新取证。Concord 本地及 fake host 验证不代表真实消费仓库已完成原生验收。

## 执行副本与证据

v2 formal receipt 与 certificate 绑定实际固定执行副本，Concord 与 host 共用版本化源码投影。所属 E2E Repo 的 JS/TS 源路径集合及 raw/code SHA 被记录；只剥除成功解析的真实受管注释，不剥除字符串、模板或普通代码。复制和执行前后检测漂移，不声称覆盖完整依赖闭包。派生测试引用、native path、契约路径与完整 Markdown SHA 同时绑定。合法关系登记不会使刚生成的 proof 自失效，helper 断言、路径集合与契约变化会使它陈旧。旧 receipts 不用于新 fixed。

Research、Memory、Issue 与通用入口共用唯一当前模型。历史处理声明迁移为未验证 attestation；新的 repository resolution 保存正式 gate 核验后的原文件摘要、invocation 身份和 Memory epoch。完整语义与一次性迁移见[文档模型与迁移](document-migration.md)。

## 安装与使用

`concord --skill repository` 提供按需命令指引，不加载 host。NiceEval 锁定已构建的 `tools/concord/concord-sdlc-0.4.0.tgz`，三处依赖使用相对 `file:` 路径，lockfile 保存 integrity；消费仓库无需 Concord checkout。全局 link 用于 Concord 本身日常开发，不能绕过 profile engine identity。
