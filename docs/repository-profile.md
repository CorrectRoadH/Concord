# Repository profile

Concord 的通用模式使用自己的 Markdown、测试注释和 command evidence。`concord repo` 则运行消费仓库明确选择的 repository profile，保持它的既有命令、文档格式和 formal evidence 契约。

NiceEval 的领域实现由 Concord 的 `repository/` 拥有，编译产物从 `concord-sdlc/repository/*` 导出。NiceEval 原路径仅保留转出声明供既有源码链接定位，实际实现不在本地重复维护。根脚本保留 `pnpm run repo`、`pnpm memory`、`pnpm pr:body` 等名字和参数。

消费仓库根目录的 `concord.repository.json` 声明 `format: concord.repository/v1` 和一个 canonical `host` 路径。host 默认导出 `concord.repository-host/v1`、真实 runner root 与正式 inventory/evidence APIs。它是本地作者维护的可信代码，仅在显式 repository profile 中加载；通用 help 不加载它。

执行前核对 Git 顶层、host root，以及当前执行 engine 与消费者锁定安装包的实际文件摘要。全局 brew 版本不同会返回 `RepositoryEngineMismatch`，应改用仓库锁定的 `pnpm run repo`。摘要包括实际 engine 和包依赖锁，不依赖版本号或 host 自报。

NiceEval 的 candidate、Testkit、原生 collection、正式 red/green/takeover 和 owned process 仍由自身 E2E runner 拥有。Concord 不把 command 收据转换为 formal evidence。私有 bundle 的实现身份改变后按原协议重新签发；已发布的 sidecar 证据和 Memory 历史继续按原规则读取，不重写数据。

设计经过独立只读挑战并获 PASS。切换和发布验收包括：安装后真实最小 inventory、所有根入口 help、隔离写入及失败清理、身份不匹配与 command proof 拒绝、读取基线对照，以及两个项目的必需检查。未重跑完整 formal red/green/takeover 时不声称其正向验收完成。
