# 命令体验

## 接入

`concord --skill` 读取简短 Agent 入口；`--skill <topic>` 按入口列出的主题展开具体命令，`--skill all` 提供全文。这个入口在任意 cwd 可读，不加载 host 或修改文件。

维护者先运行 `concord init`，再用 `doctor` 查看测试根和关联缺口。`template list/show` 可在尚未初始化的目录中查看随包模板。

## 规划与维护

`feature`、`use-case`、`engineering`、`research`、`design` 与 `roadmap` 提供具名 create/list/show 操作；package page 通过 `page show/set` 使用整文件 digest 防止覆盖并发编辑。`author set` 只替换作者正文并保留工具 metadata。

## 实现关联

`init --source-root src` 可重复配置实现源码根；已有项目维护 `concord.config.ts` 的可选 sourceRoots。`code annotate --scope file|node|region --contract <ref>` 只生成无 ID 注释，重复 contract 可关联多个 Feature、Use Case 或 Engineering 契约。

`code list` 返回当前声明，`code locate <path> --line <n>` 查询全部包含作用域。内部引用自动派生，不要求使用者维护。`trace show` 返回独立 codeDeclarations 和 implements 边；代码声明不代替测试或完成证明。完整语法见 `concord --skill code`。

## 测试与证据

`test annotate` 只输出经验证的注释片段，不写源码。`test list/show` 发现当前声明；`test run <case>` 使用配置 argv 且 `shell=false`。`memory resolve --kind fixed` 需要当前 epoch 的 red/green command evidence 和非空原因。

## 检查与审阅

`check`、`trace check`、`trace show` 和 `review render` 都不执行测试。`cache clear/rebuild/status` 只管理派生投影，`recover` 处理未完成 publication。`cache rebuild` 在 Git-private 目录缺失时安全创建它；重建后缓存仍不可读时以 `CacheRebuildUnavailable` 失败，JSON 成功结果附 `cacheStatus`。

只读快照内，读取过的条目被按大小写改名时，当前来源命令在快照结束时报 `PreimageChanged`（details 为 `source-observation`），不再在第二次读取时报 `UnsafePath`。非普通文件在初次读取或扫描时报 `InvalidFile`，核验阶段报 `UnsafePath`；symlink 与越界在任何阶段都报 `UnsafePath`。macOS 低于 11 时以 `UnsupportedHost` 拒绝。规则见[读取路径安全检查的成本边界](../../design/path-safety-cost/plans/anchored-root/architecture.md)。

## 中立高级治理

消费仓库通过锁定的 `concord repo` 入口加载自己的 host。`docs test` 的 current 关系写在真实声明上方，native inventory 校验 ID/path；history/tombstone 保存在注释归档。正式 v2 red/takeover 由 host 执行并签发，已有回归使用显式 `regression refresh --reason` 更新陈旧证据。此入口的 formal gate 不接受通用 command receipts。

## 原生测试 adapter

`concord test collect [<file>...]` 显式运行配置的 adapter，保存可丢弃的原生清单观察。`test list/show` 只读展示 `current`、`complete` 与 `gaps`；`check` 与 `trace` 不运行收集、不依据观察改变关系结论。

`concord test run <case-id>` 重新收集并绑定当前原生集合；`--require-native` 要求精确原生选择。范围不足时可以在源码标记块添加 `@native <native-id>`；它不参与 v1 关联身份。无法精确绑定时执行范围为文件级 command；显式要求 native 时具名失败。

配置 `testAdapters` 按测试根内的路径段匹配且不得重叠。每项声明 `id`、`include`、`builtin` 或外部 `argv`、`implementationFiles`、`inputRoots`、`frameworkVersion`、`lockFiles` 与 `envNames`；超时和预算只可缩小硬上限。未覆盖的文件使用原 runner。

原生收据为 `concord.native-evidence/v2`，包含 requested、observed、Invocation 状态及输入摘要。green、red 与 invalid 表达逐项执行裁决；command scope 的 pass/fail 不表述为原生通过。缺少、重复、额外、skip、超时或清理未知均不能用于 fixed。能力与边界见[原生 adapter Use Case](use-case/run-native-test-adapters.md)。

`inputScope` 展示仓库内输入成员、摘要、排除项和框架/运行时版本。系统库、工具链、外部服务和包缓存无法冻结时，观察标记 `ExternalInputUnknown`、`complete=false`；仍可按完整 provider 收集范围授权精确 native 选择。原生收据保留环境 gap 和版本，`complete` 仅表示逐项报告完整，不能满足 repository profile 的原生可靠性等级。
