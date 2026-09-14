# Repository profile

Concord 的通用模式和 repository profile 都使用 `concord.project/v1`、`concord.document/v1` Markdown、测试注释和各自的 evidence 契约。`concord repo` 运行消费仓库明确选择的 profile，但不再解析或生成 NiceEval 旧 node frontmatter 文档。

NiceEval 的领域实现由 Concord 的 `repository/` 拥有，编译产物从 `concord-sdlc/repository/*` 导出。NiceEval 原路径仅保留转出声明供既有源码链接定位，实际实现不在本地重复维护。根脚本保留 `pnpm run repo`、`pnpm memory`、`pnpm pr:body` 等名字和参数。

消费仓库根目录的 `concord.repository.json` 声明 `format: concord.repository/v1` 和一个 canonical `host` 路径。host 默认导出 `concord.repository-host/v1`、真实 runner root 与正式 inventory/evidence APIs。它是本地作者维护的可信代码，仅在显式 repository profile 中加载；通用 help 不加载它。

执行前核对 Git 顶层、host root，以及当前执行 engine 与消费者锁定安装包的实际文件摘要。全局 engine 字节不同会返回 `RepositoryEngineMismatch`，应改用仓库锁定的 `pnpm run repo`。摘要包括实际 engine 和包依赖锁，不依赖版本号或 host 自报。

NiceEval 的 candidate、Testkit、原生 collection、正式 red/green/takeover 和 owned process 仍由自身 E2E runner 拥有。Concord 不把 command 收据转换为 formal evidence。私有 bundle 的实现身份改变后按原协议重新签发；旧 v1 receipts、证据索引与 fixed Memory 保留为历史，不重写数据；新 fixed 必须使用 v2 formal evidence。

设计经过独立只读挑战并获 PASS。切换和发布验收包括：安装后真实最小 inventory、所有根入口 help、隔离写入及失败清理、身份不匹配与 command proof 拒绝、读取基线对照，以及两个项目的必需检查。未重跑完整 formal red/green/takeover 时不声称其正向验收完成。

## 当前关系与历史

真实测试声明紧邻的 `@concord-case`、`@concord-owner`、可重复 `@concord-regression` / `@concord-issue` 单行注释拥有 current。title 末尾继续携带同一个永久 case ID。helper 用 `@concord-test-file` 明示 native owner path；AST 只定位注释，inventory 仍由原生 collection 见证。历史和 tombstone 只追加到 `e2e/concord-history.ts`，源码删去后仍保留 ID，不保存第二份 current JSON registry。

source、helper、归档和 evidence index 的变化共享 journal 与完整 preimage CAS。刷新已有 regression 的 legacy/stale proof 使用显式 `regression refresh --reason`，要求 open Problem 和新受管 v2 evidence；归档旧索引指针，不改写旧 receipts 或重复追加 relation。

## 执行副本与证据

v2 formal receipt 与 certificate 绑定实际固定执行副本，Concord 与 host 共用版本化源码投影。所属 E2E Repo 的 JS/TS 源路径集合及 raw/code SHA 被记录；只剥除成功解析的真实受管注释，不剥除字符串、模板或普通代码。复制和执行前后检测漂移，不声称覆盖完整依赖闭包。case/native path、owner/contract refs 与完整 Markdown SHA 同时绑定。合法关系登记不会使刚生成的 proof 自失效，helper 断言、路径集合与契约变化会使它陈旧。旧 v1 不用于新 fixed；历史读路径显示 legacy/stale/unavailable。

## 安装与使用

`concord --skill repository` 提供按需命令指引，不加载 host。NiceEval 锁定已构建的 `tools/concord/concord-sdlc-0.3.0.tgz`，三处依赖使用相对 `file:` 路径，lockfile 保存 integrity；消费仓库无需 Concord checkout。全局 link 用于 Concord 本身日常开发，不能绕过 profile engine identity。
