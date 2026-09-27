---
format: concord.document/v1
id: recall-and-maintain-memory
title: 通过工具检索与维护工程知识
createdAt: 2026-09-23T02:08:50.650Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 通过工具检索与维护工程知识

工程 Memory 保存排障经过、调查结论与可复用经验；Issue 保存待调查观察；产品契约声明目标、行为与约束。三者不复制同一事实。

## 工具契约

Agent 使用 `concord memory index` 获取当前派生索引，使用 `concord memory recall <query>` 获取匹配的 Memory 正文、当前摘要和生命周期。不维护 INDEX.md 等人工索引，不用 cat/rg 文件替代记忆检索入口。recall 是确定性的本地文本检索，不调用模型或远端服务，不宣称向量或语义检索。

recall 与 search 按空白把查询拆成词项，每个词项不区分大小写地匹配标题或正文，全部词项都命中的记录才返回。空查询以 `InvalidInput` 拒绝。人读输出为每条命中列出标题、状态与含首个命中词项的正文片段；`--json` 返回完整正文与摘要。Issue recall 使用同一匹配规则。

创建使用 memory add；修改正文使用 `memory edit <id-or-path> --body <file> --expected-digest <digest>` 或 author set；状态、关联与证明使用对应具名命令。不直接编辑受管 Memory/Issue 文件、metadata、history 或反向索引。正文输入文件/stdin 是命令输入，不是绕过工具写 owner。

index 与 recall 不修改来源，跨来源重复短 ID 明确拒绝并要求 canonical path。Memory edit 不修改其它文档 kind，不改变 evidenceRequirement、epoch、证明或关联。read-only 来源在发布边界拒绝修改。

list、index、recall 与 search 在共享 snapshot 中读取相应来源的全部候选 owner。范围内坏记录、来源缺失、配置错误或未完成事务使该查询失败。集合查询先按物理来源限定路径，再解码。

精确 canonical path 的编辑只要求指定 owner 与当前摘要有效，并使用独占 publication。短 ID 编辑读取该类别的全部候选，唯一匹配后才写入；集合不完整或 ID 歧义时拒绝。create 校验目标路径和写来源权限。Issue 还校验同类 ID 集合，Problem 还校验证据政策。精确路径不要求其它 Memory 内容有效。短 ID 必须看见未成功解码的候选，避免隐藏其中的同 ID。

读取范围与失败边界见[本地 SDLC 架构](../architecture.md)。

## 验收

打包 CLI 在隔离消费者中创建并 index/recall Memory，以返回的摘要编辑正文；回读可见更新，陈旧摘要与只读来源拒绝。多词查询只返回全部词项命中的记录，词项顺序与大小写不影响结果。索引不写文件，recall 返回实际原文与摘要，不创造证明。init 的 AGENTS 托管区、docs/concord.md 与随包 skill 都路由到当前命令。
