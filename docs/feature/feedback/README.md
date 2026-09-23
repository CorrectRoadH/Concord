---
format: concord.document/v1
id: feedback
title: 多来源反馈与本地处理
createdAt: 2026-09-14T00:00:00.000Z
kind: feature
constitutionRefs:
  - docs/constitution.md#c-012
  - docs/constitution.md#c-001
  - docs/constitution.md#c-002
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-005
  - docs/constitution.md#c-006
  - docs/constitution.md#c-007
  - docs/constitution.md#c-010
---

# 多来源反馈与本地处理

维护者和 AI 将本地观察、GitHub issue、Linear issue 汇入同一反馈入口，关联 Feature 或工程 Memory，并在项目中保留调查笔记和处理结论。来源由可扩展的读取适配器提供；产品契约和修复证据仍由各自 owner 管理。

Web 以常驻反馈导航和右侧详情组织处理流程，导航提供搜索、来源和处理状态筛选；选择反馈后直接阅读或编辑本地正文。手机通过共享内容导航抽屉选取反馈。导入与同步在反馈入口显式操作，连接表单归项目设置。CLI 提供同样的领域操作及结构化结果，适合 AI 按需读取和处理。Use Case 继续隶属于 Feature；反馈不是另一套产品需求注册表。

- [处理来自不同来源的反馈](use-case/triage-feedback.md)
- [CLI 与 Web 用法](cli.md)
- [身份、存储与接入边界](architecture.md)
- [生命周期](lifecycle.md)
- [适配器接口](library.md)
- [CLI 登录态复用设计](cli-integration.md)

支持 GitHub 公共 API 实例与 Linear 公共 API，默认使用环境变量提供读取凭据。GitHub 还可在项目设置中显式选择 gh，复用运行 Concord 的机器上的 GitHub CLI 登录态，无需在项目中配置凭据；要求 gh 2.98.0 或更新版本及 POSIX 进程组能力。连接检测与同步需明确触发；不轮询远端、不发布或修改远端 issue，也不实现 webhook 接收和 OAuth 授权流程。两种模式的保证见[CLI 接入设计](cli-integration.md)。

- [无外部服务时管理本地观察](use-case/manage-local-observations.md)
- [来源与工程知识术语](terminology.md)
