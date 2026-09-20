# 文档目录与历史格式迁移

## L1: 路径拥有 canonical identity

路径拥有 canonical identity；现有 NiceEval Research 有 124 个 owner，其中 31 个 README、93 个单文件，包含嵌套 owner。来源：原设计约束。判定依据是迁移不得用目录分组替代 owner 身份。

## L2: 现有格式与链接不可静默丢失

9 个 Engineering、17 个 Roadmap、14 个 Design 缺少当前 metadata；17 个 Feature 主题已具备。55 个旧 Design 候选目录仍采用 PLAN-N。单文件移动后相对链接的解析基准发生变化，不能只替换入站链接。来源：原设计约束。判定依据是补齐 metadata 并逐项重定向链接。

## L3: 研究组织自由且不新增登记表

用户要求正文自由，不预设章节或附页。最小 README 入口及工具身份字段不规定研究方法。Markdown owner、当前正向引用和历史证据分别有自己的来源；迁移审计不是运行时 registry。来源：原设计约束。判定依据是迁移只补格式和路径，不创建第二份事实来源。

## L4: 保留现场并使用可恢复发布

两个 checkout 有大量此前未提交改动，必须以实际前像保护，不重置或覆盖。当前平台采用 Linux 本地 Git-private publication lease 与可恢复日志。历史证据不能通过路径重写冒充当前验证。来源：原设计约束。判定依据是完整前像、共享锁/journal 与证据语义。
