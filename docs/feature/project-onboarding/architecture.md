# 渐进式项目初始化与品味治理架构

运行时只接受当前静态 TS 配置，避免并存多个授权模型。

## 配置快照

`ConfigSnapshot` 为 `{path: "concord.config.ts", source, digest, config}`：`source` 是实际原文，`digest` 绑定其完整字节。`config` 由 TypeScript 语法树静态求值后按 `ProjectSchema` 严格解码，不加载模块，不解析类型依赖。

配置文件不存在时快照记为 absent，`config` 取[默认值](use-case/maintain-project-config.md#配置项)。项目目录的身份取 worktree 根与 Git-private 目录（在创建工作区时解析一次并缓存），配置在文件 `(mtime, size, inode)` 变化时重新读取与解码。`config.set` action 单独发布并重写规范化 TS 全文，不与 Memory 修改同批；普通发布不得删除或改名唯一配置。

## 运行时格式识别

定位项目目录后，工作区服务在启动或恢复时自动检查 Git-private 目录中的 `journal.json`：

- 目标文件仍匹配写入前摘要或计划摘要时，自动回滚或补完并清理 `journal.json`。
- 目标文件已被外部编辑器修改，或 `journal.json` 属于陈旧格式时，保留磁盘上的当前文件、清理陈旧 `journal.json` 并输出告警，不锁死仓库。
- `concord.config.ts` 本身不符合当前 Schema 时返回 `InvalidData` 或 `InvalidConfigSyntax`，保留配置文件原文。

## Journal 与恢复授权

`journal.json` 记录本次写入涉及的目标路径、写入前摘要与计划摘要。`config.set`、文档写入与源码写入共用同一套 `journal.json` 与 CAS 摘要校验，不维护多套锁文件（如 `publication.lock`）。

## 初始化规划

init 的配置路径与发现范围取自最终计划配置快照；新建目录只能是计划文件的必要祖先。预览使用只读[来源快照](../portable-coordination/concepts.md#source-snapshot)；正式提交在工作区服务的写互斥下核对期望摘要并原子写入，期间目标文件被外部修改时返回 `FileChangedSinceRead`。

## 品味

品味条目与款的 ID 从 Markdown 语法树的标题与根有序列表项取得。引用扫描复用共享的链接提取与路径规范化，不另建索引。品味由人与 agent 直接编辑，没有专用写命令。

## 写作指南与示例

写作流程由 skill 主题承载，文档分类与页面职责由 `docs/document-model.md` 拥有，目录树与成稿示例位于 `docs/guides/spec-examples.md`。归档资源同时包含 docs 与 skills；`--skill document` 依次读取主题、文档模型和示例，用相同的内容校验和具名错误返回正文。`--skill all` 在 document 主题处包含这两份资料各一次。

读取使用安装资源路径，不以接入项目 cwd 查找示例，也不把示例复制成该项目的 Spec。Herdr 的初始化请求只提供项目位置、写作目标和 `start` 入口；目标路由与范围判断归指南，不在提示词中固定二选一流程。

初始化生成的 `docs/concord.md` 只维护任务到当前 skill 的入口与本地文档导航，不保存配置 Schema、标记语法或修复核验步骤的副本。模板提供对应页面的写作提示，完整分类与写法通过 `--skill document` 取得，不假设接入项目存在 Concord 自身的文档模型文件（[一件事只写一次](../../taste.md#t-3)）。

指南的结构与行为验收分别进行：资源测试核对完整输出、安装路径和失败边界；代表性任务的正文、范围与操作选择按[审阅 agent 指南](../../engineering/testing/use-case/review-agent-guidance.md)验收。检查通过或指南成功输出不证明 agent 能完成任务。

