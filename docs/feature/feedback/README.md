---
format: concord.document/v1
id: feedback
title: 多来源反馈与本地处理
createdAt: 2026-09-14T00:00:00.000Z
kind: feature
---

# 多来源反馈与本地处理

维护者和 AI 将本地观察、GitHub issue、Linear issue 汇入同一反馈入口，关联 Feature 或工程 Memory，并在项目中保留调查笔记和处理结论。来源由可扩展的读取适配器提供；产品契约和修复证据仍由各自 owner 管理。

Web 提供反馈列表、筛选、导入、连接表单和 Markdown 编辑。CLI 提供同样的领域操作及结构化结果，适合 AI 按需读取和处理。Use Case 继续隶属于 Feature；反馈不是另一套产品需求注册表。

- [处理来自不同来源的反馈](use-case/triage-feedback.md)
- [CLI 与 Web 用法](cli.md)
- [身份、存储与接入边界](architecture.md)
- [生命周期](lifecycle.md)
- [适配器接口](library.md)

当前支持 GitHub 公共 API 实例与 Linear 公共 API，使用环境变量提供读取凭据。同步需明确触发；不轮询远端、不发布或修改远端 issue，也不实现 webhook 接收和 OAuth 授权流程。
