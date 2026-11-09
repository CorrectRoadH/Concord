# 代码结构

本页回答维护者怎样组织 Concord 的代码：分几层、每个模块放什么、谁能依赖谁，以及各进程由哪些服务组合。模块内怎样命名与写错误见[代码规范](README.md)，系统总览见[技术架构](../../architecture.md)。

代码由 Effect 服务组成（[技术栈](../build/README.md#技术栈)）。领域逻辑只依赖端口；文件、进程、时间、网络与缓存等副作用由基础服务提供。每种进程用一组 Layer 组合出自己被允许的能力。

固定版本 Effect 已等价提供的能力直接使用，不重复实现。库未提供的保证（例如进程组清理确认、字节预算）由 Concord 的适配层补齐。

## 分层

| 层 | 内容 | 依赖 |
| --- | --- | --- |
| 入口 | CLI 命令（`effect/cli`）、HTTP 路由（`effect/http`）、RPC 处理（`effect/rpc`）、Concord mod | 应用端口 |
| 应用 | 每个用户操作一个 `Effect.fn`，CLI、HTTP、action 与 RPC 调用同一个操作 | 领域服务与基础服务 |
| 领域服务 | Documents、Trace、Writing、Concepts、Issues、Memory、Designs、Tests、Code、Feedback | 领域服务、基础服务与模型 |
| 基础服务 | Workspace、Sources、Publication、Cache、Git、OwnedProcess，以及 `effect` 的 FileSystem、Path 与 Clock | 平台 |
| 模型 | Schema、纯函数与算法（解析、关系推导、写作规则），不依赖任何服务 | 无 |

- `--version` 与各层 `--help` 输出构建时从命令定义生成的静态数据，见[入口与命令加载](../../feature/local-sdlc/architecture.md#入口与命令加载)。
- 应用操作的输入、结果与错误由 Schema 定义。应用端口包括 [Queries](#应用端口-queries)。
- 领域服务之间可以互相依赖，依赖关系无环，例如 Trace 依赖 Documents、Code 与 Tests。层级见[依赖规则](#依赖规则)。
- 基础服务的 Node 实现来自 `@effect/platform-node`。

## 平台能力边界

普通文件读写、命令执行、网络与标准流通过 Effect 的 FileSystem、ChildProcessSpawner、Socket、HTTP 与 Stdio 提供。领域与应用声明需要的服务，入口组合 Layer；领域逻辑不直接读取进程环境或操作平台资源。

直接调用 Node API 只用于两种场合：

1. 入口读取启动参数、环境与信号。
2. Effect 缺少所需保证的基础适配，例如防符号链接的描述符读取、文件身份复核、IPC 和进程组清理确认。

适配封装在所属基础服务内，并说明缺少的保证、失败语义和资源释放方式。放进 `base` 本身不构成保留理由。

模型保持纯计算，只有摘要计算可以使用 `node:crypto`（见[依赖规则](#依赖规则)）。模块内怎样命名与写错误见[代码规范](README.md)。架构规则约束能力与所有权，具体 AST 检查方式由[架构守护](../testing/architecture.md#架构守护)维护（[规则少而硬](../../taste.md#t-8)）。

## 模块布局

源码按层分目录，每个目录是一个模块。入口文件 `index.ts` 是模块对外的唯一出口，只导出本模块的接口，不转出其它模块的实现；模块之间只通过出口导入。

产品运行时代码位于 `src/`、`web/`（浏览器前端）。`test/`、`bench/` 与 `scripts/` 是维护的 TypeScript 源码，分别拥有验证、性能场景与构建编排。

```text
src/
  model/        纯模型：Schema、Markdown 与 frontmatter 解析、文档身份推导、关系推导、写作规则、作用域与路径算法、步骤、代码引用
  base/         基础服务：environment、installation、workspace、sources、publication、cache、git、process
  domain/       领域服务：documents、designs、trace、tests、code、issues、memory、taste、writing、concepts、feedback、onboarding、docs-work
  app/          应用操作、Queries 端口与 ViewAction
  entry/        入口：cli、http（Web 工作台的服务端）、server（工作区服务的主进程、计算进程与操作进程）、lsp、herdr-mod
web/            浏览器前端，只调用 HTTP 接口
```

下表说明每个 Feature 的架构职责边界。同一模块被多个 Feature 使用是正常的交叉职责；实际的实现归属由源码声明派生，不维护第二份登记。

| Feature | 模块 |
| --- | --- |
| [local-sdlc](../../feature/local-sdlc/README.md) | `domain/documents`、`domain/trace`、`domain/tests`、`domain/code`、`domain/issues`、`domain/memory`、`entry/cli`、`entry/lsp` |
| [document-packages](../../feature/document-packages/README.md) | `domain/documents`、`domain/designs` |
| [documentation-quality](../../feature/documentation-quality/README.md) | `domain/writing`、`domain/concepts`、`model` 的写作规则 |
| [project-onboarding](../../feature/project-onboarding/README.md) | `domain/onboarding` |
| [taste](../../feature/taste/README.md) | `domain/taste` |
| [feedback](../../feature/feedback/README.md) | `domain/feedback`、`domain/issues` |
| [neutral-project-governance](../../feature/neutral-project-governance/README.md) | `domain/tests`（runner 与 adapter）、`domain/docs-work` |
| [local-data-engine](../../feature/local-data-engine/README.md) | `base/cache`、`entry/server` |
| [portable-coordination](../../feature/portable-coordination/README.md) | `base/publication` |
| [web-workbench](../../feature/web-workbench/README.md) | `entry/http`、`web/` |
| [herdr-mod](../../feature/herdr-mod/README.md) | `entry/herdr-mod`（Concord mod） |
| [cross-platform-release](../../feature/cross-platform-release/README.md) | `base/installation` 与 `scripts/` 的发行组装 |

同一职责只有一个实现：一个关系编译器、一个文档解码器、一个 publication 协议。

## 依赖规则

| 模块 | 可以导入 |
| --- | --- |
| `model` | `effect`、纯解析依赖白名单、`node:crypto` 的摘要函数，以及其它 `model` 模块 |
| `base` | `model`、平台层与预编译 HawDB 的 TypeScript 绑定 |
| `domain` | `model`、`base` 与下文层级中排在它之前的 `domain` 模块 |
| `app` | `domain`、`base`、`model` |
| `entry` | `app`、`domain` 与 `model`；组合根另可导入 Layer 与其它入口的出口 |

- `model` 的纯解析依赖白名单是 `yaml`、`mdast-util-*` 与 `micromark-*`、`mdast` 类型。`model` 不做文件读取、动态加载、时间、随机数、进程状态或缓存实例。
- `base` 不导入领域或应用。
- `app` 只拥有跨领域的编排操作与统一服务动作（`ViewAction`、`Queries`），不为单领域的只读函数做一比一的透传重导出（[一件事只写一次，其余推导](../../taste.md#t-3)）。
- `entry` 的组合根是各入口的 `entry/<入口>/main.ts`。只有组合根可以导入 `domain` 与 `base` 的 Layer 以及其它入口模块的出口；入口的其它文件互不导入。

领域之间的依赖按以下层级，只能依赖排在前面层级的模块。同一层级的领域互不依赖，需要同层能力时由 `app` 编排，或提取共享的纯模型。

1. `documents`：owner 读取、inventory 与精确引用解析；
2. `concepts`、`taste`、`designs`、`issues`、`memory`、`docs-work`：各自拥有生命周期与采用操作，`issues` 拥有远端写入与 IssueProject 端口，`docs-work` 拥有写集规划与 scoped-clean 规则；
3. `writing`（依赖 `concepts`）、`code`、`tests`；
4. `trace`（依赖 `documents`、`code`、`tests`、`taste`）、`feedback`（依赖 `issues`）、`onboarding`（模板、配置与初始化规则，依赖 `documents`、`concepts`、`taste`、`writing`）。

一个入口需要启动另一个入口时（`concord view` 启动 HTTP 服务、`concord lsp` 启动语言服务），由该入口自己定义启动端口，组合根用对方入口的实现提供。协议实现留在对方入口，`app` 不感知传输。

跨领域的编排在 `app`：分析观察对关系结果的补充、初始化与配置治理、步骤改写、docs work 的检查与收尾。`code` 不回调 `trace`，`concepts` 不依赖 `writing`，共享的作用域与路径算法在 `model`。

模块边界与领域依赖方向同时约束值引用和类型引用。类型引用表达编译期耦合，不代表运行时执行；领域依赖层级保证运行时依赖无环。

内部动态加载遵守同一边界。接入项目的可执行模块只在受控进程入口加载，避免把项目代码带入检查与主服务进程。

## 公开接口

Concord 只以 CLI 交付，全部模块都是内部实现，不作为包导出（[目标与原则](../../architecture.md#目标与原则)）。唯一入口是发版归档中的 `bin/concord`。对外的接口是命令的 `--json` 输出、外部 adapter 的 stdin/stdout 协议与导出产物；配置、adapter 协议与 PR 预览产物的 JSON Schema 由 `concord schema` 从拥有这些结构的内部 Schema 输出，见[机器可读 Schema](../../feature/local-sdlc/cli.md#机器可读-schema)。

## 测试布局

测试分层与目录职责由[测试架构](../testing/README.md)定义；运行入口、构建产物使用与检查顺序由[构建与检查入口](../testing/README.md#检查入口)定义。

## 基础服务

| 服务 | 职责 |
| --- | --- |
| RuntimeEnvironment | 一次调用或一个进程的 cwd 与完整环境变量 |
| Installation | 安装目录、运行资源的定位与安装身份 |
| Workspace | 定位项目目录、Git-private 目录与安装身份（启动时解析一次并缓存），读取操作开始时的配置 |
| Sources | 路径规范化校验、基于 `(mtime, size, inode)` 的快速读取与内容摘要计算 |
| Publication | 进程内写互斥、单一 `journal.json`、CAS 摘要核对、原子替换与自动恢复 |
| Cache | 内存增量工作区图与 `cache.hawdb` 持久缓存的读写 |
| Git | 状态、diff、提交与 worktree 操作 |
| OwnedProcess | 外部子进程（如测试 runner、LSP 外部服务）的启动、信号、进程组清理确认与输出预算 |

**RuntimeEnvironment**：每个入口提供自己的值。其余代码从它取得路径、环境与子进程的设置，不直接读取宿主进程，缺少的变量不回落到宿主。规则见[进程内 CLI](../testing/architecture.md#进程内-cli)。

**Installation** 定位安装目录根、源码运行时的根、原生产物、模板与 skill 资源。原生产物在源码运行时取自经身份校验的共享缓存，安装后取自安装目录。

安装身份是安装目录全部 JS 与原生产物的内容摘要。它按元数据指纹缓存在用户缓存目录，指纹由各文件的 device、inode、大小、mtime、ctime 与目录成员组成。指纹任一变化时重新计算内容摘要，因此产物被替换时仍能发现。

**Workspace** 在创建时解析一次 worktree 根与 Git-private 目录并缓存在上下文内，不在每次操作中重复启动同步 `git rev-parse` 子进程。配置在配置文件 `(mtime, size, inode)` 变化时重新读取与解码。

### 操作上下文 {#operation-context}

领域代码不持有仓库对象。一次操作的事实由两个服务提供：

- `WorkspaceContext`：项目目录、Git-private 目录、配置、访问方式（只读或写入）与缓存模式。
- `SourceSnapshot`：当前操作读取的来源视图，复用工作区服务内存中的增量工作区图与按 `(mtime, size, inode)` 校验的文件缓存。

进程期保留的领域服务在方法调用时取得它们，不在 Layer 构建时捕获某次操作的配置或环境。基础与领域层统一提供 Effect 接口，不维护带 `Sync` 后缀的重复同步入口。

### 提交与恢复的视图 {#publication-views}

- **提交**：领域算出变更计划与目标文件的期望摘要后交给 `Publication`。`Publication` 在进程内写互斥下核对目标文件当前摘要、调用 `PublicationValidation`、写入单一 `journal.json` 并以同目录临时文件原子 `rename` 替换，完成后立即增量更新内存工作区图并删除 `journal.json`。
- **恢复**：工作区服务启动或显式运行 `concord recover` 时自动检查 `journal.json`。目标文件仍等于写入前摘要或计划摘要时自动回滚或补完；若外部编辑器已修改目标文件，则以磁盘当前文件为准清理陈旧 `journal.json` 并输出告警，不锁死仓库。
- **dry-run** 走同样的路径、期望摘要与领域校验，不写 `journal.json`、不修改磁盘文件。

### 能力边界 {#capability-boundaries}

- 读方法只依赖 `Sources` 与 `Cache`；写方法在自己的依赖中显式要求 `Publication`，执行测试的方法显式要求 `OwnedProcess`。每个领域只有一个服务，读与写的差别体现在方法的依赖上，不体现在两套服务上。
- `Publication` 是唯一的提交者。发布前检查需要领域校验（写作规则、概念目录、步骤重命名与 Issue 关闭的规划）时，经 `PublicationValidation` 端口取得。端口定义在 `base`，实现在 `app`，由入口的组合根提供。
- `Cache` 由工作区服务单内核统一持有（`--server=command` 或无服务单次执行时由当前进程持有），不再拆分跨进程的 `CacheSnapshot` 与 `CacheDerivations` 分块搬运。
- 纯解析与关系编译保持纯函数，CPU 密集的 Markdown 与 TypeScript AST 解析可在工作区服务的内部解析线程池中执行。

**OwnedProcess** 让外部子进程使用当前 RuntimeEnvironment 的环境，用 `effect/process` 的 ChildProcess 启动与发送信号，负责进程组清理确认、TERM 到 KILL 的上限与输出预算。

## 应用端口 Queries

Queries 是应用操作端口，CLI 与 Concord mod 默认通过 RPC 调用工作区服务，Web 通过 HTTP 调用同一套应用操作，`--dry-run`、cache-off 或 `--server=command` 在当前进程内调用同一实现。

各入口共用同一份完整的操作定义：输入模式、领域结果与错误 Schema，以及从结果到退出码的映射。公开输出只在入口生成一次。

## 服务操作

工作区服务的每个应用操作只定义一次：名称、输入、结果与错误 Schema、准入与取消，以及读写语义。所有操作均在工作区服务单内核进程内调度（重度解析交由内部线程池，外部测试命令交由 `OwnedProcess`），不再派发给独立的计算子进程、刷新子进程或预热操作子进程。RPC 与 HTTP 是薄适配层：

- RPC 负责二进制序列化与帧准入。
- HTTP 负责 Host/Origin 校验、请求体上限、状态码、ETag 与安全头。SSE 是 `subscribe` 的 HTTP 编码，保留慢消费者合并与 `stopping` 事件。
- 静态资源、p5 frame 与 SPA 页面只属于 HTTP。

| 操作 | 执行位置 | 语义 | HTTP | RPC |
| --- | --- | --- | --- | --- |
| `hello`、`shutdown`、`http` 监听 | 服务内核 | 控制与 HTTP 监听引用计数 | — | 控制帧 |
| `subscribe` | 服务内核 | 内存中的当前工作区图状态与之后的事件 | `GET /api/events`（SSE） | 是 |
| `workspace` | 服务内核 | 当前增量工作区投影 | `GET /api/workspace` | 是 |
| `refresh` | 服务内核 | 触发增量核对与刷新 | `POST /api/workspace` | 是 |
| `read` | 服务内核 | 当前来源的定向读取；RPC 返回原始字节与信封，HTTP 返回 `ViewFile` | `GET /api/file` | 是 |
| `query` | 服务内核 | CLI 与 LSP 的只读及增量 overlay 查询 | — | 是 |
| `git-status`、`git-diff` | 服务内核 | 当前 Git 状态与定向 diff | `GET /api/git`、`GET /api/git/diff` | 是 |
| `p5-compile` | 服务内核 | 当前来源捕获与编译 | `POST /api/p5/compile` | — |
| `action` | 服务内核 | 统一写入、恢复、反馈与缓存操作；写入后直接增量更新工作区图 | `POST /api/action` | 是 |
| `job-start`、`job-list`、`job-cancel` | 服务内核监督，runner 经 `OwnedProcess` | 单槽测试任务 | `POST /api/jobs`、`GET /api/jobs`、`DELETE /api/jobs/:id` | 是 |
| `cache-clear`、`cache-status`、`cache-rebuild` | 服务内核 | 缓存状态、清理与重建 | 经 `action` | 是 |

测试任务只有一个槽位。浏览器断开不取消任务；取消要确认外部 runner 进程组退出后才释放槽位。`view export` 只在 CLI 本进程执行。

## 进程能力

| 进程 | 角色与能力 |
| --- | --- |
| 工作区服务（单内核） | 持有唯一 `server/lock` 与持久 `cache.hawdb`，维护内存增量工作区图与内部解析线程池，执行全部查询、写入、恢复、LSP overlay 计算与测试任务监督，提供 RPC 与 HTTP 接口 |
| CLI / `concord lsp` / Concord mod | 薄客户端：定位项目目录，经本机 socket 调用工作区服务并渲染输出；`--server=command` 或无服务模式在本进程内运行同一内核 Layer |

每个入口的 Layer 构建在测试中验证：缺少能力时编译或构建失败，不在运行时才发现。

## 采用的 Effect 能力

| 需要 | Effect 能力 | Concord 补齐 |
| --- | --- | --- |
| 资源生命周期 | Scope、`Effect.acquireRelease`、`Layer.effect` | — |
| 工作区服务协议 | `effect/rpc`（请求关联、具名错误、取消、结果流）经 `effect/socket` | 二进制序列化与传输准入，见[协议](../../feature/local-data-engine/architecture.md#协议) |
| 当前状态与订阅 | SubscriptionRef | 每个订阅只保留最新状态；慢订阅的旧状态被替换，计入发送预算 |
| 合并监听事件与增量刷新 | Stream 与 Schedule | 去抖合并文件变更事件，按变更路径增量更新工作区图 |
| 读写与维护互斥 | Semaphore / Ref | 进程内串行化写入、缓存清理与单槽测试任务；跨进程只需唯一 `server/lock` |
| 在途请求与取消 | FiberMap、FiberSet | 键为连接与请求身份；中断外部 runner 时确认进程组回收 |
| 启动就绪 | Deferred | — |
| HTTP 与静态资源 | HttpRouter、HttpStaticServer | Host/Origin 校验，见[Web 工作台架构](../../feature/web-workbench/architecture.md) |
| 测试中的时间与协议 | TestClock；RpcTest | 服务状态机与计时在测试进程内以 Layer 加 TestClock 验证 |
| 性能剖析 | `Effect.fn` 的 span，按需经 `effect/observability` 导出 | — |
