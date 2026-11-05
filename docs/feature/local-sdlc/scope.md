# 本地 SDLC 的范围与验收

Concord 让一个 Git worktree 用仓库内可审阅的 Markdown 与测试源码表达产品 Spec、可执行验收、Issue 和 Memory。它面向离线、可移植的开发流程：文档与源码是事实来源，全部文件可以直接编辑。缓存可以随时删除，删除后结论不变。修复核验的结论写在 Issue 中，中断写入的恢复记录必须保留。

开发由 Concord Spec 驱动：修改功能前先读取或更新 Feature、Use Case、cli 或 library 页与必要 Design，再进入实现和测试。`concord trace gaps --json` 派生当前显式实现/测试关系缺口，帮助发现尚未建立关系的 Spec 和已建档 CLI 页面；它不等于代码覆盖率，也不能发现从未建档的命令。

## 用户价值

维护者可以从同一个 CLI 完成接入、规划、测试关联、修复核验、Issue 与 Memory 生命周期、追踪和审阅，不需要 NiceEval checkout、全局凭据、部署服务或第二份关系注册表。

## 范围

- 初始化文档布局、写作指南、完整参考模板与可选的项目配置，不覆盖已有文件。
- 按固定布局组织 Feature、Use Case、Roadmap、Design、Engineering、Issue 与 Memory；身份由路径决定，名称由一级标题决定，frontmatter 只保存推导不出的字段（[领域与数据所有权](library.md#owner)）。
- 全部文件直接编辑；`new`、`roadmap start`、`issue close` 等命令执行需要运行的步骤并把结果写进文件。
- 从整文件、函数和完整代码段旁的注释反查 Feature / Use Case / Engineering 实现关联，支持按源码行定位；查询引用自动派生，无需手写声明 ID。
- 从测试根里的 Concord 标记发现 case，不解析宿主测试语法。缓存损坏或删除时从源码重新计算。
- 运行项目声明的 argv；把 Issue 关闭为 fixed 前，核验回归测试在缺陷提交上失败、在修复提交上通过，并把结论写进 Issue（[核验修复并关闭缺陷](use-case/resolve-with-command-evidence.md)）。
- 写入不越出 worktree，不覆盖未知改动，中断后可以恢复。
- 从 owner 动态编译 trace，并渲染本地 review 材料。

## 非目标

Concord 不把修复核验描述成原生 runner 的逐 case 覆盖率或 formal E2E；不自动发布、push、调用付费模型或操作远端 Issue；缓存不保存任何无法从源码重建的事实。

## 验收

各 Use Case 均有带 `@use-case` 标记的测试。`concord check` 与 `trace check` 必须验证引用完整性；定向 `trace show` 与 `review` 必须能从当前 owner 分别反查代码声明和测试。代码声明表示实现关联，不证明 Spec 完成。

局部命令只依赖自己的输入：

- 一个 Feature 的 README 损坏时，Memory 的 list、search 与 confirm 照常工作，为另一 Feature 生成注释照常工作，全局 check 报告该损坏。
- 目标 owner、其归属链或显式 `@issue` 目标损坏时，局部命令失败，不退回祖先 owner。
- `memory/` 含无法解析的记录时，Memory 的集合查询与短选择器查询失败；另一 canonical path 的精确读取按必要依赖验证。

## 证据的范围

证据只表达实际证明的范围（[只声称证明过的](../../taste.md#t-5)）。

1. 源码声明不等于执行，命令成功收据不等于逐 case 覆盖或正式 E2E 可靠性。
2. Issue 标记为 fixed 时，同一冻结命令必须在缺陷候选上以非零结果结束、在被接受的快照上通过，两者之间测试、runner 输入与所指 Spec 不变。核验结论写入 Issue，可在声明的输入与环境下重放；command 结果不证明逐 case 执行。
3. 文档、品味结构或关系检查不得被展示为实现合规、功能完成或测试覆盖的证明。

## 独立与本地

核心流程不需要账号、模型 API 或云服务。

1. Concord 作为独立安装包工作，只需要本地 Git 仓库，不依赖其它仓库的 checkout、全局安装、provider 凭据或部署服务。
2. 可选外部接入必须有明确边界，不成为基础本地流程的前提。
3. 本地 Issue 不依赖外部服务。远端写入需单独授权，本地操作不自动投射为远端变更。

## 写入安全

人和 agent 同时编辑同一个仓库时，Concord 的写入不能破坏别人的工作。

1. 所有写入必须校验目标路径、前像与完整变更集，拒绝路径逃逸和 symlink 绕过。
2. 中断时必须保留可解释的恢复现场，不覆盖未知编辑。
3. 新增配置、来源和写入口必须同时定义资源所有权与恢复授权。
