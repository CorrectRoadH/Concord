# 测试实现

本页声明本仓库测试的 runner 适配、架构守护、Fixture 与浏览器资源。测试规则见[测试](README.md)。

## Runner 适配

`pnpm gate` 的测试阶段统一调度 Node 测试与浏览器测试，全部运行当前检出的源码：子进程以[从源码运行](../build/architecture.md#从源码运行)的方式启动，Web 页面来自共享的 Web 产物，原生产物来自共享缓存。只有打包测试使用归档。

同步测试体使用 `Effect.sync`，Node adapter 回调使用 `Effect.runPromise`；资源型测试使用 `Effect.scoped` 与 acquire/release。关联由 Concord 标记拥有，不由测试声明形状决定。

`runner.sourceFiles` 列出测试运行依赖、修复核验期间不得改变的全部非产品文件。推导从这些入口出发：全部测试文件、`e2e.config.ts`、runner 的 `argv` 与 `prepare` 直接执行的脚本。沿两类边求传递闭包：相对导入（含 `import type` 与字面 `import()`），以及以字面路径加载模块的位置，例如 `new URL('../x.ts', import.meta.url)` 作为 `--import` 或子进程入口。结果去掉 `src/` 下的文件、测试文件本身、依赖包与 `concord.config.ts`（runner 配置由修复核验单独冻结）；入口脚本本身计入。无法静态枚举的加载目标使推导失败，不静默跳过。决定运行时与依赖的 `.node-version`、`package.json`、`pnpm-lock.yaml` 与 `tsconfig.test.json` 不在导入图中，也固定列入。列表留在 `concord.config.ts`，`test/model/runner-source-files.test.ts` 从导入图推导期望集合并与列表比较，缺项或多出的项都失败。owner 测试直接写出声明，不通过包装函数隐藏。Node 测试期由 Node 自带的类型擦除加载 TypeScript（[从源码运行](../build/architecture.md#从源码运行)）。

## 架构守护

`test/architecture.test.ts` 验证[代码结构](../../architecture.md#代码结构)中的模块出口、分层方向、领域依赖顺序与入口组合规则。值引用与类型引用都检查边界；领域依赖顺序已排除环，不另外维护两套循环判断。

检查解析 TypeScript AST，不执行产品模块或消费项目代码。导入与导出图包含 `import type`、类型导入节点、字面 `import()` 和可静态枚举的内部动态目标；无法枚举的目标失败，消费项目 adapter 的受控入口按明确边界处理。

平台访问检查阻止模型、领域与应用直接导入文件、子进程、网络模块，或通过别名、解构读取 `process` 的 cwd、env、argv 与标准流；CLI 入口层只有 `entry.ts` 可以访问这些成员（[进程内 CLI](#进程内-cli)）。测试布局检查要求：`test/cli/` 的测试经 `runCli` 调用命令，不为调用另起 CLI 宿主进程，检查沿测试调用的支持函数传递判断，不只匹配测试文件里的 spawn；`test/process/` 的每个测试文件在开头的注释块声明[跨进程保证](README.md#跨进程保证)的类别与具体保证。声明合法由检查保证，保证是否必要由审阅核对实际断言。检查直接要求违规集合为空，不读取 Git 历史或维护例外数量基线。

基础适配是否确有必要由代码审阅核对[平台能力边界](../../architecture.md#平台能力边界)，目录检查不能证明资源释放正确。句柄、子进程、取消和回收通过对应的真实生命周期测试验证。能力隔离检查同时拒绝领域与应用自行打开持久缓存或选择访问模式。

## 进程内 CLI

每次 CLI 调用取得一份不可变的输入：argv（不含 Node 可执行文件与入口文件）、绝对路径的 cwd 与完整的环境变量快照。快照中没有的变量视为不存在，不与宿主进程的环境合并。相对路径、项目发现、Git、runner、LSP、安装资源、发给工作区服务的请求环境，以及子进程的 cwd 与环境，都从这份输入派生；调用不修改 `process.chdir`、`process.env` 或宿主的标准流。

基础适配需要的只读环境端口是 `base/environment` 的 [RuntimeEnvironment](../../architecture.md#基础服务)，由每个入口的组合根提供：CLI、工作区服务、计算与操作进程、LSP 与库入口各自提供自己的值，base 不导入 CLI（[代码结构](../../architecture.md#代码结构)）。argv、标准流与退出结果由 CLI 适配拥有；标准流使用 Effect 的 Stdio，Console 与 Terminal 绑定到同一次调用的输出与 TTY 能力。

生产入口与进程内入口运行同一个可等待的命令程序：同一命令定义、初始化守卫、错误呈现与退出码映射。只有真实的启动适配执行 `runMain`、安装信号处理与写入启动缓存。命令树与不带调用状态的 Layer 定义可以复用；每次调用拥有自己的 Scope、构建出的上下文、输出与退出结果，退出结果初值为 0，不写测试进程的 `process.exitCode`。原生模块、编译器等进程级加载缓存不得携带调用者的环境或消费者状态。

CLI 适配内部的 `CliInvocation` 服务拥有本次调用不可变的 argv 与退出码，设置退出码是 Effect 操作；输出、`--json` 判断、`--body` 与 stdin 读取都经本次的 argv、Stdio 与 RuntimeEnvironment。组合根不提供会覆盖这些的宿主 Stdio 与 Terminal，平台只组合文件系统、路径与子进程。`src/entry/cli/main.ts` 导出 `runCommand(command, argv)`，返回 `Effect<number>`；分组加载与完整命令都运行它，`entry.ts` 独占 `NodeRuntime.runMain`、宿主的 `process.exitCode`、信号与启动缓存，`entry-full.ts`、`cli-fallback.ts` 与 `cli.ts` 不在顶层执行、不读宿主 argv。

工作区服务的长期计算进程对每个查询，按请求携带的环境重建与环境有关的服务（Workspace、Git、OwnedProcess、Installation、ConfigProvider），消费者 root 仍取请求的 root。由调用者发起的操作进程携带调用者的环境，不复用服务启动时的环境。原生绑定按经过验证的二进制身份（路径、摘要、测试钩子模式）缓存，加载失败按同一身份分别记录，不保存调用者的环境；artifact 路径每次从快照求得。编译缓存只由真实启动适配初始化。缓存维护的排队决策在触发它的命令结束前完成，不留给下一次调用。

`test/support/cli.ts` 的 `runCli({ argv, cwd, env, stdin, signal })` 是异步入口，返回 `{ stdout, stderr, exitCode }`。stdin 接受 UTF-8 字符串或字节，给定内容后结束；输出按字节捕获、以 UTF-8 解码；TTY 默认为否。命令与 Scope 的 finalizer 都完成后才返回，清理失败时返回失败而不是成功结果；领域错误转换为退出结果，取消与宿主异常向调用者传播。命令自身需要的工作区服务、runner 等子进程保持生产行为，与真实 CLI 相同，计入门禁报告。

进程内入口须通过两组验收。环境隔离：快照里缺少的变量不回落到宿主，Git、runner、LSP 与服务请求的后代实际使用给定的环境，不同原生 artifact 的选择互不污染。调用隔离：连续调用 A、失败的 B、再 A，结果互不影响；不同 cwd、环境与 stdin 的调用并发运行；非零退出之后的下一次调用退出码为 0；帮助与参数错误的人读和 JSON 两种格式；取消后资源与信号监听全部释放。

只有真实进程才能观察的部分由进程层“运行环境”类别保留代表测试：按命令分组加载模块、按 argv 回放预先记录的输出、未捕获失败的退出码、信号处理，以及原生模块的首次加载、损坏与安装替换。代表测试与进程内命令程序对同一 argv 的输出逐字比较。

## 共享服务

进程层与 CLI 层中需要工作区服务、但不验证服务生命周期的用例，在同一测试文件内共用一个消费者与它的服务。`test/support/shared-service.ts` 的 `sharedWorkspace()` 在文件第一次调用时从模板复制消费者并启动服务；文件结束、启动失败或用例失败与取消时停止服务并确认服务进程退出，再删除消费者；清理无法确认时报告失败并保留诊断目录，不先删除消费者。

共用 fixture 的用例在文件内串行。它们不使用 `concurrency: true`，不留未 await 的子测试或未收束的后台任务。每个用例开始前，先确认上一个用例的在途操作、jobs、连接与租约已经完成或回收，再把工作树与 index 恢复到冻结 tree，HEAD 不得变化；然后显式申请刷新，等待这次申请之后完成的完整、一致投影，其 `sourceDigest` 等于初始化时捕获的冻结来源。不以提交号相同、HTTP 200 或固定等待代替。用例自己改动来源后需要新投影时，再次按同样方式等待。

改变 refs、HEAD 或 Git 配置，留下 journal 或恢复材料，改变持久缓存的内容或可读性、安装资源、服务身份或状态，或者依赖 jobs 与订阅状态的用例，使用私有 fixture。验证冷启动、重启、交接、崩溃或独占状态的用例也使用私有服务。浏览器沿用同样的恢复规则（[浏览器与诊断](#浏览器与诊断)）。

## Fixture

测试仓库由 `test/support/consumer.ts` 构造。每次测试运行先构建一个已初始化的模板消费者，每个测试复制模板得到自己的仓库，不在每个测试中重新执行 `git init` 与 `concord init`。需要不同初始状态的测试在复制后通过公开入口修改。例外是被测对象本身就是仓库初始状态的测试：未初始化仓库、非 Git 目录、shallow clone、特定提交历史或 merge 结构，这类测试自己构造仓库，并在用例中写明原因。可用的 Fixture 与新增方式见[扩展 Fixture](use-case/extend-fixtures.md)。

受管文件的内容只由格式的 owner 生成：Spec 与 Memory 通过领域写入入口或 `renderDocument`，品味由 `initialize` 写入的模板生成，配置通过 `renderTypeScriptConfig`，写作规则与 concepts 通过各自的写入入口。格式改变时只改格式 owner，测试不随之修改（[当前格式](../../architecture.md#当前格式)）。

## 浏览器与诊断

浏览器由 e2e Web engine 拥有，每个 worker 一个浏览器，每次尝试使用独立 context。精确时钟、网络边界和 DOM 检查通过 engine 的公开 `surfaceOf` 访问当前 Page；浏览器只由 engine 关闭。

每个浏览器 worker 拥有一个临时 Git 仓库与它的 View 服务，worker 结束时关闭服务后删除仓库。测试开始前把仓库恢复到 fixture 的冻结提交，等服务刷新到该提交；测试结束时关闭本测试的 context 并回收它的 HTTP 连接，保留页面供 runner 截图。需要独占服务状态的测试（例如服务停止与重启）自己另起仓库与服务，并在 finally 中回收。成功、断言失败与超时均须进入资源回收。

系统 Chromium 适配须有启动超时、取消响应、退出等待与强制终止后备路径；启动失败也须回收临时 profile。

标有 `journey` 的用例共用 fixture 与精确断言。普通门禁执行确定性操作，自然语言运行使用 `agent.act` 完成用户操作，不复制第二份场景与结果断言。写法见[写浏览器测试](use-case/write-browser-test.md#act)。
