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

Agent 使用 `concord memory index` 获取当前派生索引，使用 `concord memory recall <query>` 获取标题或正文匹配的 Memory 正文、当前摘要和生命周期。不维护 INDEX.md 等人工索引，不用 cat/rg 文件替代记忆检索入口。recall 是确定性的本地文本检索，不调用模型或远端服务，不宣称向量或语义检索。

创建使用 memory add；修改正文使用 `memory edit <id-or-path> --body <file> --expected-digest <digest>` 或现有 author set；状态、关联与证明使用对应具名命令。禁止直接编辑受管 Memory/Issue 文件、metadata、history 或反向索引。正文输入文件/stdin 是命令输入，不是绕过工具写 owner。

index 与 recall 不修改来源，跨来源重复短 ID 仍明确拒绝并要求 canonical path。Memory edit 不得修改其它文档 kind，不改变 evidenceRequirement、epoch、证明或关联。read-only 来源在原发布边界拒绝修改。

现有 memory list/search/show、issue list/show 与 author set 继续有效；新入口补齐一致的工具式工作流，不改变既有生命周期和证据门禁。

## 验收

打包 CLI 在隔离消费者中创建并 index/recall Memory，以返回的摘要编辑正文；回读可见更新，陈旧摘要与只读来源拒绝。索引不写文件，recall 返回实际原文与摘要，不创造证明。init 的 AGENTS 托管区、docs/concord.md 与随包 skill 都路由到当前命令，避免初始化后落回直接编辑。
