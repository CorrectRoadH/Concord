# 代码结构

本页回答维护者怎样组织 Concord 的代码：分几层、每个模块放什么、谁能依赖谁，以及各进程由哪些服务组合。模块内怎样命名与写错误见[代码规范](README.md)，系统总览见[技术架构](../../architecture.md)。

代码由 Effect 服务组成（[技术栈](../build/README.md#技术栈)）。领域逻辑只依赖端口；文件、进程、时间、网络与缓存等副作用由基础服务提供。每种进程用一组 Layer 组合出自己被允许的能力。

固定版本 Effect 已等价提供的能力直接使用，不重复实现。库未提供的保证（例如进程组清理确认、字节预算）由 Concord 的适配层补齐。

## 分层

| 层 | 内容 | 依赖 |
| --- | --- | --- |
| 入口 | CLI 命令（`effect/unstable/cli`）、HTTP 路由（`unstable/http`）、RPC 处理（`unstable/rpc`）、Concord mod | 应用端口 |
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

产品运行时代码位于 `src/`、`web/`（浏览器前端）与 `native/hawdb/`（原生绑定）。`test/`、`bench/` 与 `scripts/` 是维护的 TypeScript 源码，分别拥有验证、性能场景与构建编排。

```text
src/
  model/        纯模型：Schema、Markdown 与 frontmatter 解析、文档身份推导、关系推导、写作规则、作用域与路径算法、步骤、代码引用
  base/         基础服务：environment、installation、workspace、sources、publication、cache、git、process
  domain/       领域服务：documents、designs、trace、tests、code、issues、memory、taste、writing、concepts、feedback、onboarding、docs-work
  app/          应用操作、Queries 端口与 ViewAction
  entry/        入口：cli、http（Web 工作台的服务端）、server（工作区服务的主进程、计算进程与操作进程）、lsp、herdr-mod
web/            浏览器前端，只调用 HTTP 接口
native/hawdb/   HawDB 的 N-API 绑定
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
| [local-data-engine](../../feature/local-data-engine/README.md) | `base/cache`、`native/hawdb`、`entry/server` |
| [portable-coordination](../../feature/portable-coordination/README.md) | `base/publication` |
| [web-workbench](../../feature/web-workbench/README.md) | `entry/http`、`web/` |
| [herdr-mod](../../feature/herdr-mod/README.md) | `entry/herdr-mod`（Concord mod） |
| [cross-platform-release](../../feature/cross-platform-release/README.md) | `base/installation`、`scripts/` 与 `native/hawdb` 的发行构建 |

同一职责只有一个实现：一个关系编译器、一个文档解码器、一个 publication 协议。

## 依赖规则

| 模块 | 可以导入 |
| --- | --- |
| `model` | `effect`、纯解析依赖白名单、`node:crypto` 的摘要函数，以及其它 `model` 模块 |
| `base` | `model`、平台层与 `native/hawdb` 的 TypeScript 绑定 |
| `domain` | `model`、`base` 与下文层级中排在它之前的 `domain` 模块 |
| `app` | `domain`、`base`、`model` |
| `entry` | `app` 与 `model`；组合根另可导入 Layer 与其它入口的出口 |

- `model` 的纯解析依赖白名单是 `yaml`、`mdast-util-*` 与 `micromark-*`、`mdast` 类型。`model` 不做文件读取、动态加载、时间、随机数、进程状态或缓存实例。
- `base` 不导入领域或应用。
- `entry` 的组合根是各入口的 `entry/<入口>/main.ts`，以及同一入口下各进程的 `entry/<入口>/<进程>/main.ts`（例如工作区服务的计算进程与操作进程）。只有组合根可以导入 `domain` 与 `base` 的 Layer 以及其它入口模块的出口；入口的其它文件互不导入。

领域之间的依赖按以下层级，只能依赖排在前面层级的模块。同一层级的领域互不依赖，需要同层能力时由 `app` 编排，或提取共享的纯模型。

1. `documents`：owner 读取、inventory 与精确引用解析；
2. `concepts`、`taste`、`designs`、`issues`、`memory`、`docs-work`：各自拥有生命周期与采用操作，`issues` 拥有远端写入与 IssueProject 端口，`docs-work` 拥有写集规划与 scoped-clean 规则；
3. `writing`（依赖 `concepts`）、`code`、`tests`；
4. `trace`（依赖 `documents`、`code`、`tests`、`taste`）、`feedback`（依赖 `issues`）、`onboarding`（模板、配置与初始化规则，依赖 `documents`、`concepts`、`taste`、`writing`）。

一个入口需要启动另一个入口时（`concord view` 启动 HTTP 服务、`concord lsp` 启动语言服务），由该入口自己定义启动端口，组合根用对方入口的实现提供。协议实现留在对方入口，`app` 不感知传输。

跨领域的编排在 `app`：分析观察对关系结果的补充、初始化与配置治理、步骤改写、docs work 的检查与收尾。`code` 不回调 `trace`，`concepts` 不依赖 `writing`，共享的作用域与路径算法在 `model`。

模块边界与领域依赖方向同时约束值引用和类型引用。类型引用表达编译期耦合，不代表运行时执行；领域依赖层级保证运行时依赖无环。

内部动态加载遵守同一边界。消费项目的可执行模块只在受控进程入口加载，避免把项目代码带入检查与主服务进程。

## 公开接口

库包 `concord-sdlc` 只导出四个子路径，行为见[库接口](../../feature/local-sdlc/library.md)：

- `concord-sdlc/config`：`concord.config.ts` 的类型；
- `concord-sdlc/model`：文档 Schema 与模型类型；
- `concord-sdlc/test-adapter-protocol`：原生测试 adapter 的协议；
- `concord-sdlc/change-preview`：PR 静态预览产物的 Schema。

其余模块是内部实现，不导出。CLI 入口是发版归档中的 `bin/concord`，库包没有 `bin`。

## 测试布局

测试分层与目录职责由[测试架构](../testing/README.md)定义；运行入口、构建产物使用与检查顺序由[构建与检查入口](../testing/README.md#检查入口)定义。

## 基础服务

| 服务 | 职责 |
| --- | --- |
| RuntimeEnvironment | 一次调用或一个进程的 cwd 与完整环境变量 |
| Installation | 安装目录、运行资源的定位与安装身份 |
| Workspace | 项目目录、对应的 Git-private 目录与安装身份 |
| Sources | 路径安全的读取、来源快照与返回前核验 |
| Publication | 租约、journal、原子替换与恢复 |
| Cache | 解析缓存、只读快照与持久命名空间的独占写入 |
| Git | 状态、diff、提交与 worktree 操作 |
| OwnedProcess | 子进程的启动、信号、后代清理确认与输出预算 |

**RuntimeEnvironment**：每个入口提供自己的值。其余代码从它取得路径、环境与子进程的设置，不直接读取宿主进程，缺少的变量不回落到宿主。规则见[进程内 CLI](../testing/architecture.md#进程内-cli)。

**Installation** 定位安装目录根、源码运行时的根、原生产物、模板与 skill 资源，以及工作进程入口。原生产物在源码运行时取自经身份校验的共享缓存，安装后取自安装目录。

安装身份是安装目录全部 JS 与原生产物的内容摘要。它按元数据指纹缓存在用户缓存目录，指纹由各文件的 device、inode、大小、mtime、ctime 与目录成员组成。指纹任一变化时重新计算内容摘要，因此产物被替换时仍能发现。

**Workspace** 的配置快照在每次操作与刷新时重新读取与核验，不作为进程期事实缓存。

**Publication** 的租约以 `Effect.acquireRelease` 在 Scope 中持有。发布前检查与恢复需要领域校验（写作规则、概念目录、步骤重命名与 Issue 关闭的规划），经 `PublicationValidation` 端口取得。端口定义在 `base`，实现在 `app`，由入口的组合根提供；缺少时 Layer 无法构建。

**Cache** 的三种能力分开提供：

- 解析缓存，内存或持久；
- 只读快照 `CacheSnapshot`：进程内不可写的行，不经内存 HawDB；
- 持久命名空间的独占写入。

计算进程另有 `CacheDerivations`：只在请求内收集新产生的派生行，随结果交回主进程写入；它不持有句柄或写入能力。

**OwnedProcess** 让子进程使用当前 RuntimeEnvironment 的环境，用 `unstable/process` 的 ChildProcess 启动与发送信号。Concord 补齐后代清理确认、TERM 到 KILL 的上限、输出预算、清理未知时的隔离与结果记录。leader 成功退出时也核对后代。

## 应用端口 Queries

Queries 是白名单只读查询的应用端口，有两个实现：`Queries.Local` 调用同一应用查询，`Queries.Remote` 是工作区服务的 RPC 客户端。CLI 默认使用 Remote，计算进程使用 Local。

两个实现共用同一份完整的操作定义：输入模式、领域结果与错误 Schema，以及从结果到退出码的映射。公开输出只在入口生成一次。

Remote 在适配层区分可重试的传输失败与领域错误，不在客户端计算。断线重试，以及 `--dry-run` 与 cache-off 在本进程执行的规则，由[CLI 查询](../../feature/local-data-engine/architecture.md#cli-查询)拥有。

## 服务操作

工作区服务的每个应用操作只定义一次：名称、输入、结果与错误 Schema、准入与取消、执行位置、当前或历史语义，以及发布后是否申请刷新。RPC 与 HTTP 是适配层：

- RPC 负责二进制序列化与帧准入。
- HTTP 负责 Host/Origin 校验、请求体上限、状态码、ETag 与安全头。SSE 是 `subscribe` 的 HTTP 编码，保留慢消费者合并与 `stopping` 事件。
- 静态资源、p5 frame 与 SPA 页面只属于 HTTP。

| 操作 | 执行位置 | 语义 | HTTP | RPC |
| --- | --- | --- | --- | --- |
| `hello`、`shutdown`、`http` 租约 | 主进程 | 控制 | — | 控制帧 |
| `subscribe` | 主进程 | 内存中的当前结果与之后的事件 | `GET /api/events`（SSE） | 是 |
| `workspace` | 主进程 | 已接受的结果（历史） | `GET /api/workspace` | 是 |
| `refresh` | 主进程申请，计算进程执行 | 申请刷新，不等待 | `POST /api/workspace` | 是 |
| `read` | 计算进程 | 当前来源的定向严格读取；RPC 返回原始字节与信封，HTTP 返回 `ViewFile` | `GET /api/file` | 是 |
| `query` | 计算进程 | 白名单当前查询，见[CLI 查询](../../feature/local-data-engine/architecture.md#cli-查询) | — | 是 |
| `git-status`、`git-diff` | 计算进程 | 当前 Git 状态与定向 diff | `GET /api/git`、`GET /api/git/diff` | 是 |
| `p5-compile` | 计算进程 | 当前来源捕获与编译，编译器经 `OwnedProcess` | `POST /api/p5/compile` | — |
| `action` | 操作进程（写入、恢复与反馈）；`cache.*` 转给主进程 | ViewAction；写入后申请刷新 | `POST /api/action` | — |
| `job-start`、`job-list`、`job-cancel` | 主进程监督，runner 经 `OwnedProcess` | 单槽任务 | `POST /api/jobs`、`GET /api/jobs`、`DELETE /api/jobs/:id` | — |
| `cache-clear` | 主进程 | 见[清理](../../feature/local-data-engine/architecture.md#清理) | 经 `action` | 是 |
| `cache-status`、`cache-rebuild` | 主进程；重建计算交给计算进程 | 持有者读取状态并保存重建结果 | 经 `action` | 是 |
| `cache-snapshot`、`cache-derived` | 主进程 | 本地 CLI 操作读取快照与分块提交派生行 | — | 是 |
| `feedback-merge` | 主进程 | begin、append、commit，commit 原子生效 | — | 是 |

测试任务只有一个槽位。浏览器断开不取消任务；取消要确认子进程组退出后才释放槽位。

`feedback.sync` 与 `feedback.check` 的 HTTP 请求断开时取消外部操作，任务不随连接取消。`view export` 只在 CLI 本进程执行。

## 进程能力

| 进程 | 提供 | 不提供 |
| --- | --- | --- |
| CLI | Workspace、Sources、Publication、Git、OwnedProcess、Cache、Queries.Remote | — |
| 工作区服务主进程 | Workspace、Git、Cache 的持久独占写入、工作区投影、RPC 与 HTTP 服务、计算与操作进程的监督 | 领域计算 |
| 计算进程 | Workspace、Sources、Cache（内存解析、主进程交来的只读快照与 `CacheDerivations`）、Queries.Local | Publication、持久 Cache、OwnedProcess 之外的子进程 |
| 操作进程 | Workspace、Sources、Publication、Git、OwnedProcess、Cache（内存）、远端读取 | 持久 Cache |
| Concord mod | 原生界面、公开 CLI 查询、正文读写与文件监听，见[mod 数据访问](../../feature/herdr-mod/architecture.md#数据) | 领域计算、持久 Cache |

- CLI 的 Cache 是内存缓存；有服务时使用服务的快照和派生行，无服务时使用持久缓存。
- 工作区服务主进程只在清理作用域中、关闭持久库之后获得 Publication。
- 计算进程经标准输入输出接收 RPC：结构以 JSON 编码，入口按计算请求 Schema 严格解码；来源原文以二进制字节帧传输。计算进程的日志只写标准错误。
- 计算进程的结构不用 SchemaBinary，因为固定版本的 SchemaBinary 无法编译含共享字面量前缀的元组联合。
- 操作进程发布后，经 `feedback-merge` 更新远端观察。

每个入口的 Layer 构建在测试中验证：缺少能力时编译或构建失败，不在运行时才发现。

## 采用的 Effect 能力

| 需要 | Effect 能力 | Concord 补齐 |
| --- | --- | --- |
| 资源生命周期 | Scope、`Effect.acquireRelease`、`Layer.effect` | — |
| 工作区服务协议 | `unstable/rpc`（请求关联、具名错误、取消、结果流）经 `unstable/socket` | 二进制序列化与传输准入，见[协议](../../feature/local-data-engine/architecture.md#协议) |
| 当前状态与订阅 | SubscriptionRef | 每个订阅只保留最新状态；慢订阅的旧状态被替换，计入发送预算 |
| 合并监听事件与补偿刷新 | Stream 与 Schedule | 去抖最长等待两秒，扫描期间只合并一次后续刷新 |
| 串行维护 | Semaphore | 只在进程内互斥；服务锁、publication 与超时各自裁决 |
| 在途请求与取消 | FiberMap、FiberSet | 键为实例、连接与请求身份；中断不替代进程组回收与 60 秒超时 |
| 启动就绪 | Deferred | — |
| HTTP 与静态资源 | HttpRouter、HttpStaticServer | Host/Origin 校验，见[Web 工作台架构](../../feature/web-workbench/architecture.md) |
| 测试中的时间与协议 | TestClock；RpcTest | 见下文 |
| 性能剖析 | `Effect.fn` 的 span，按需经 `unstable/observability` 导出 | — |

服务的状态机与计时在测试进程内以 Layer 加 TestClock 验证。TestClock 不抢占同步计算，也不产生文件或进程事件；计算与操作进程、服务锁、进程退出与清理确认用真实进程验证。RpcTest 只验证逻辑，公开输出等价用真实序列化验收。
