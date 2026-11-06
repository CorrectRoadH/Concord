# 测试实现

本页声明本仓库测试的 runner 适配、架构守护、Fixture 与浏览器资源。测试规则见[测试](README.md)。

## Runner 适配

`pnpm gate` 的测试阶段统一调度 Node 测试与浏览器测试，全部运行当前检出的源码：子进程以[从源码运行](../build/architecture.md#从源码运行)的方式启动，Web 页面来自共享的 Web 产物，原生产物来自共享缓存。只有打包测试使用安装包。

同步测试体使用 `Effect.sync`，Node adapter 回调使用 `Effect.runPromise`；资源型测试使用 `Effect.scoped` 与 acquire/release。关联由 Concord 标记拥有，不由测试声明形状决定。

`runner.sourceFiles` 列出测试运行依赖、修复核验期间不得改变的全部非产品文件：从全部测试文件沿相对导入可达、且不在 `src/` 下的文件（测试文件本身除外），加上 `e2e.config.ts` 与 runner 命令直接执行的脚本。列表留在 `concord.config.ts`，`test/model/runner-source-files.test.ts` 从导入图推导期望集合并与列表比较，缺项或多出的项都失败。owner 测试直接写出声明，不通过包装函数隐藏。Node 测试期由 Node 自带的类型擦除加载 TypeScript（[从源码运行](../build/architecture.md#从源码运行)）；`.node-version`、`package.json`、`pnpm-lock.yaml` 与 `tsconfig.test.json` 共同进入 evidence definition digest。

## 架构守护

`test/architecture.test.ts` 验证[代码结构](../../architecture.md#代码结构)中的模块出口、分层方向、领域依赖顺序与入口组合规则。值引用与类型引用都检查边界；领域依赖顺序已排除环，不另外维护两套循环判断。

检查解析 TypeScript AST，不执行产品模块或消费项目代码。导入与导出图包含 `import type`、类型导入节点、字面 `import()` 和可静态枚举的内部动态目标；无法枚举的目标失败，消费项目 adapter 的受控入口按明确边界处理。

平台访问检查阻止模型、领域与应用直接导入文件、子进程、网络模块，或通过别名、解构读取 `process` 的 cwd、env、argv 与标准流。检查直接要求违规集合为空，不读取 Git 历史或维护例外数量基线。

基础适配是否确有必要由代码审阅核对[平台能力边界](../../architecture.md#平台能力边界)，目录检查不能证明资源释放正确。句柄、子进程、取消和回收通过对应的真实生命周期测试验证。能力隔离检查同时拒绝领域与应用自行打开持久缓存或选择访问模式。

## Fixture

测试仓库由 `test/support/consumer.ts` 构造。每次测试运行先构建一个已初始化的模板消费者，每个测试复制模板得到自己的仓库，不在每个测试中重新执行 `git init` 与 `concord init`。需要不同初始状态的测试在复制后通过公开入口修改。例外是被测对象本身就是仓库初始状态的测试：未初始化仓库、非 Git 目录、shallow clone、特定提交历史或 merge 结构，这类测试自己构造仓库，并在用例中写明原因。可用的 Fixture 与新增方式见[扩展 Fixture](use-case/extend-fixtures.md)。

受管文件的内容只由格式的 owner 生成：Spec 与 Memory 通过领域写入入口或 `renderDocument`，品味由 `initialize` 写入的模板生成，配置通过 `renderTypeScriptConfig`，写作政策与 concepts 通过各自的写入入口。格式改变时只改格式 owner，测试不随之修改（[当前格式](../../architecture.md#当前格式)）。

## 浏览器与诊断

浏览器由 e2e Web engine 拥有，每个 worker 一个浏览器，每次尝试使用独立 context。精确时钟、网络边界和 DOM 检查通过 engine 的公开 `surfaceOf` 访问当前 Page；浏览器只由 engine 关闭。

每个浏览器 worker 拥有一个临时 Git 仓库与它的 View 服务，worker 结束时关闭服务后删除仓库。测试开始前把仓库恢复到 fixture 的冻结提交，等服务刷新到该提交；测试结束时关闭本测试的 context 并回收它的 HTTP 连接，保留页面供 runner 截图。需要独占服务状态的测试（例如服务停止与重启）自己另起仓库与服务，并在 finally 中回收。成功、断言失败与超时均须进入资源回收。

系统 Chromium 适配须有启动超时、取消响应、退出等待与强制终止后备路径；启动失败也须回收临时 profile。

标有 `journey` 的用例共用 fixture 与精确断言。普通门禁执行确定性操作，自然语言运行使用 `agent.act` 完成用户操作，不复制第二份场景与结果断言。写法见[写浏览器测试](use-case/write-browser-test.md#act)。
