# 测试实现

本页声明本仓库测试的 runner 适配、架构守护、Fixture、浏览器资源与门禁的内存隔离。测试规则见[测试](README.md)。

## Runner 适配

`pnpm gate` 的测试阶段统一调度 Node 测试与浏览器测试，全部运行当前 worktree 的源码。子进程以[从源码运行](../build/architecture.md#从源码运行)的方式启动，Web 页面来自共享的 Web 产物，原生产物来自共享缓存。只有打包测试使用归档。

Node 测试期由 Node 自带的类型擦除加载 TypeScript（[从源码运行](../build/architecture.md#从源码运行)）。同步测试体使用 `Effect.sync`，Node adapter 回调使用 `Effect.runPromise`；资源型测试使用 `Effect.scoped` 与 acquire/release。关联由 Concord 标记拥有，不由测试声明形状决定。

### 修复核验冻结的文件

`runner.sourceFiles` 列出测试运行依赖、修复核验期间不得改变的全部非产品文件。清单从导入图推导：

1. 入口是全部测试文件、`e2e.config.ts`，以及 runner 的 `argv` 与 `prepare` 直接执行的脚本。
2. 从入口沿两类边求传递闭包：相对导入（含 `import type` 与字面 `import()`），以及以字面路径加载模块的位置，例如作为 `--import` 或子进程入口的 `new URL('../x.ts', import.meta.url)`。
3. 结果去掉 `src/` 下的文件、测试文件本身、依赖包与 `concord.config.ts`；入口脚本本身计入。runner 配置由修复核验单独冻结。
4. 无法静态枚举的加载目标使推导失败，不静默跳过。
5. `.node-version`、`package.json`、`pnpm-lock.yaml` 与 `tsconfig.test.json` 决定运行时与依赖，但不在导入图中，固定列入。

清单留在 `concord.config.ts`。`test/model/runner-source-files.test.ts` 从导入图推导期望集合并与清单比较，缺项或多出的项都失败。owner 测试直接写出声明，不通过包装函数隐藏。

## 架构守护

`test/architecture.test.ts` 验证[代码结构](../code/architecture.md)中的模块出口、分层方向、领域依赖顺序与入口组合规则。值引用与类型引用都检查边界；领域依赖顺序已排除环，不另外维护两套循环判断。

检查解析 TypeScript AST，不执行产品模块或消费项目代码。导入与导出图包含 `import type`、类型导入节点、字面 `import()` 和可静态枚举的内部动态目标。无法枚举的目标失败，消费项目 adapter 的受控入口按明确边界处理。

平台访问检查阻止模型、领域与应用直接导入文件、子进程、网络模块，也阻止它们通过别名或解构读取 `process` 的 cwd、env、argv 与标准流。CLI 入口层只有 `entry.ts` 可以访问这些成员（[进程内 CLI](#进程内-cli)）。能力隔离检查同时拒绝领域与应用自行打开持久缓存或选择访问模式。

测试布局检查有两条：

1. `test/cli/` 的测试经 `runCli` 调用命令，不为调用另起 CLI 宿主进程。检查沿测试调用的支持函数传递判断，不只匹配测试文件里的 spawn。
2. `test/process/` 的每个测试文件在开头的注释块声明[跨进程保证](README.md#跨进程保证)的类别与具体保证。检查只保证声明合法，保证是否必要由审阅核对实际断言。

检查直接要求违规集合为空，不读取 Git 历史，也不维护例外数量基线。

目录检查不能证明资源释放正确。基础适配是否确有必要，由代码审阅按[平台能力边界](../code/architecture.md#平台能力边界)核对；句柄、子进程、取消和回收通过对应的真实生命周期测试验证。

## 进程内 CLI

CLI 层的测试在测试进程里运行和真实 CLI 相同的命令程序，不为每次调用另起一个 Node 进程。这要求一次调用的全部输入都是显式给出的：argv、cwd、完整的环境变量与 stdin，输出与退出码也只属于这次调用。

为此有三条规则：

1. 调用只看给它的输入。相对路径、项目发现、Git、runner、LSP、安装资源、缓存位置，以及它启动或请求的子进程与工作区服务，都从这次调用的 cwd 与环境派生；给定环境里没有的变量就是没有，不回落到测试进程的环境。调用不改测试进程的 cwd、环境、标准流或退出码。
2. 只有真实入口接触真实进程。`src/entry/cli/entry.ts` 读取宿主的 argv、cwd 与环境，安装信号处理，写退出码；其余代码通过[基础服务](../code/architecture.md#基础服务)的环境端口取值。
3. 每次调用的资源各自独立。命令定义可以复用；一次调用打开的缓存句柄、连接与输出在调用结束时释放，不留给下一次。原生模块等进程级的加载可以共享，但不能带上某次调用的环境或消费者状态。

测试通过 `test/support/cli.ts` 的 `runCli` 调用，得到这次的 stdout、stderr 与退出码。命令本身需要的工作区服务等子进程照常启动，与真实 CLI 相同。

只在真实进程中才看得到的行为，例如按命令分组加载、回放预先记录的输出、信号与未捕获失败的退出码、原生模块的首次加载与损坏，留在进程层的“运行环境”类别测试。

## 共享服务

冷启动一个工作区服务要几秒。不验证服务生命周期的测试，同一个文件内共用一个消费者和它的服务（`test/support/shared-service.ts` 的 `sharedWorkspace()`），而不是每个用例各起一个。

共用要守三条规则：

1. 用例在文件内串行，互不依赖对方的写入。每个用例开始前，先等上一个用例的操作与连接结束，再把文件恢复到冻结的提交，并等到服务重新扫描、结果与冻结来源一致之后才开始。
2. 会改变共享状态的用例不共用：改 Git 历史或配置、留下 journal、改缓存或安装、停止或重启服务、杀进程。它们使用自己的仓库与服务。
3. 文件结束或失败时停止服务、确认服务进程已经退出，再删除消费者；确认不了就报告失败并保留现场。

浏览器 worker 的共用仓库遵守同样的规则（[浏览器与诊断](#浏览器与诊断)）。

## Fixture

测试仓库由 `test/support/consumer.ts` 构造。每次测试运行先构建一个已初始化的模板消费者，每个测试复制模板得到自己的仓库，不在每个测试中重新执行 `git init` 与 `concord init`。需要不同初始状态的测试在复制后通过公开入口修改。

被测对象本身就是仓库初始状态时，测试自己构造仓库，并在用例中写明原因。这类状态包括未初始化仓库、非 Git 目录、shallow clone、特定提交历史或 merge 结构。可用的 Fixture 与新增方式见[扩展 Fixture](use-case/extend-fixtures.md)。

受管文件的内容只由格式的 owner 生成：Spec 与 Memory 通过领域写入入口或 `renderDocument`，品味由 `initialize` 写入的模板生成，配置通过 `renderTypeScriptConfig`，写作规则与 concepts 通过各自的写入入口。格式改变时只改格式 owner，测试不随之修改（[当前格式](../../architecture.md#当前格式)）。

## 浏览器与诊断

浏览器由 e2e Web engine 拥有，每个 worker 一个浏览器，每次尝试使用独立 context。精确时钟、网络边界和 DOM 检查通过 engine 的公开 `surfaceOf` 访问当前 Page；浏览器只由 engine 关闭。

每个浏览器 worker 拥有一个临时 Git 仓库与它的 View 服务，worker 结束时关闭服务后删除仓库。测试开始前先确认上一用例已经收束：它的 context、HTTP 连接与订阅已关闭，它发起的写入与刷新都已结束。再比较仓库与 fixture 的冻结提交，范围包括未跟踪与忽略的文件、index、HEAD 与配置。

没有差异、且服务当前投影绑定的来源身份就是冻结提交的来源身份时，不再请求刷新，直接开始。其余情况（有差异，或没有差异但投影不是冻结来源、尚未就绪）先恢复差异，再请求刷新并等到投影绑定冻结来源；无法确认时失败，不直接开始。需要服务内存从零开始的用例使用私有服务。恢复与等待的耗时计入该用例，并在报告中单独列出。测试结束时关闭本测试的 context 并回收它的 HTTP 连接，保留页面供 runner 截图。

需要独占服务状态的测试（例如服务停止与重启）自己另起仓库与服务，并在 finally 中回收。成功、断言失败与超时均须进入资源回收。

系统 Chromium 适配须有启动超时、取消响应、退出等待与强制终止后备路径；启动失败也须回收临时 profile。

标有 `journey` 的用例共用 fixture 与精确断言。普通门禁执行确定性操作，自然语言运行使用 `agent.act` 完成用户操作，不复制第二份场景与结果断言。写法见[写浏览器测试](use-case/write-browser-test.md#act)。

## 内存隔离

门禁按[内存](README.md#共享资源与同步)规则限制自身的内存峰值，在有 systemd user scope 的环境中这样实现：

1. 门禁在独立的 systemd scope 中运行，以门禁的内存上限为 `MemoryMax`。超出时只终止门禁本身，不影响同一会话中的其它进程。
2. 每次门禁另建一个只属于它的 slice 包住这个 scope。slice 设同样的 `MemoryMax`，并禁用 swap。
3. 报告的峰值读自 slice，因为较旧的 systemd 删除被 OOM 终止的 scope 时不保留其峰值。
4. 门禁的调用方在报告写完后回收 scope 与 slice。

没有 systemd user scope 的环境不建 scope 与 slice，报告写明 `memoryIsolation: "unavailable"` 与原因。
