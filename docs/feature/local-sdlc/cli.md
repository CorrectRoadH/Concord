# 命令体验

## 接入

`concord --skill` 读取简短 Agent 入口；`--skill <topic>` 按 init/document/code/test/memory/trace/recovery/repository 展开具体命令，`--skill all` 提供全文。这个入口在任意 cwd 可读，不加载 host 或修改文件。

维护者先运行 `concord init`，再用 `doctor` 查看测试根和关联缺口。`template list/show` 可在尚未初始化的目录中查看随包模板。

## 规划与维护

`feature`、`use-case`、`engineering`、`research`、`design` 与 `roadmap` 提供具名 create/list/show 操作；package page 通过 `page show/set` 使用整文件 digest 防止覆盖并发编辑。`author set` 只替换作者正文并保留工具 metadata。

## 实现关联

`init --source-root src` 可重复配置实现源码根；已有项目维护 `concord.config.ts` 的可选 sourceRoots。`code annotate --scope file|node|region --contract <ref>` 只生成无 ID 注释，重复 contract 可关联多个 Feature、Use Case 或 Engineering 契约。`code list` 返回当前声明，`code locate <path> --line <n>` 查询全部包含作用域。内部引用自动派生，不要求使用者维护。`trace show` 返回独立 codeDeclarations 和 implements 边；代码声明不代替测试或完成证明。完整语法见 `concord --skill code`。

## 测试与证据

`test annotate` 只输出经验证的注释片段，不写源码。`test list/show` 发现当前声明；`test run <case>` 使用配置 argv 且 `shell=false`。`memory resolve --kind fixed` 需要当前 epoch 的 red/green command evidence 和非空原因。

## 检查与审阅

`check`、`trace check`、`trace show` 和 `review render` 都不执行测试。`cache clear/rebuild/status` 只管理派生投影，`recover` 处理未完成 publication。

## 中立高级治理

消费仓库通过锁定的 `concord repo` 入口加载自己的 host。`docs test` 的 current 关系写在真实声明上方，native inventory 校验 ID/path；history/tombstone 保存在注释归档。正式 v2 red/takeover 由 host 执行并签发，已有回归使用显式 `regression refresh --reason` 更新陈旧证据。此入口的 formal gate 不接受通用 command receipts。
