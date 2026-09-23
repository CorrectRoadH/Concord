---
format: concord.document/v1
id: scoped-terminology-acceptance
title: 目录作用域术语与写作政策验收
createdAt: 2026-09-23T03:38:20.591Z
kind: memory
memoryKind: note
state: captured
epoch: 0
promotions: []
history: []
---

# 目录作用域术语与写作政策验收

2026-09-23 按 docs/design/scoped-terminology/README.md 的采用方案完成：docs 下按目录归属的 concepts.json 与 concord-writing.json 拥有结构化定义和写作政策；JSON 真源支持稳定局部 ID、多语言首选/允许/弃用名称、直接引用和派生汇总。全局和祖先范围合成，兄弟定义隔离；Markdown 保留解释。CLI、Web 写作页和文档术语页共用 JSON 后端，移除旧 Markdown 术语解析。

本轮通过 Herdr 的独立 Astra 只读挑战落实六项条件，由 GPT-6 Sol 执行后端和 Web。原有未提交改动保留；未提交或推送。两个执行 tab 与挑战 pane 均已回收，没有新建工作树。

## 验证

- 最终 pnpm check：242/242 通过，零失败、零取消，包含严格类型检查、完整构建、隔离打包 CLI 及真实浏览器。
- 初轮 239/242：局部政策浏览器 fixture 没有正文，旧外部修改提示断言未更新，写作扫描测试遗漏 inspect-writing 关联。分别补真实输入、修正提示断言并恢复真实测试关联；保留空范围拒绝和 CAS 冲突检查。Web 定向 9/9、自托管定向 1/1 后重跑全量通过。
- Concord 自身通过 concepts 工具写入全局、feedback Feature 和 concord-self-hosting Engineering 三份 catalog，8 个概念，无聚合诊断。反馈术语 Markdown 改为解释与来源链接。
- Concord check、采用设计 check、文档写作 check 及 skill 校验通过；自身写作扫描 204 文件、零发现。并行打开本仓库工具曾触发 RepositoryBusy，随后顺序执行成功；没有删除租约或改写现场。
- 指定消费者 /home/ctrdh/.herdr/worktrees/NiceEval/repot-tool 使用本轮独立打包安装 CLI，复现 972 文件、199 项既有发现：95 禁词、92 句长、12 段长。未批量改写这些问题，也未迁移 NiceEval 的全部领域定义。
- 临时 Feature/Engineering 定义同名概念，验证兄弟隔离、允许别名与弃用词区别、全局直接引用、被引用定义删除保护及摘要不变。Feature 红态 2 项（弃用词与未正确使用概念），修正正文后 0；Engineering 别名场景 0。
- 真实消费者 Web 验证目录切换、概念修改保存、切换后重读和来源汇总。新增两份临时正文后项目扫描 974 文件，仍只有原有 199 项发现。服务停止且临时文件清理后消费者 Git 状态恢复为空；原 NiceEval checkout 状态也为空。
- 独立 v1 journal 场景：新 CLI 返回 RecoveryConflict 且保留全部字节；匹配旧 CLI 正确 rolled-back。旧 writing/v1 需作者显式迁移，不从 Markdown 名称编造定义或把允许别名自动当禁词。

验收日志及临时截图位于 /tmp/concord-scoped-accept.xgpatvl9；这是本轮本地观察记录，不等同 NiceEval 原生 E2E 覆盖或长期可用的证据归档。
