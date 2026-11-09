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

