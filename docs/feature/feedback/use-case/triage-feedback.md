---
format: concord.document/v1
id: triage-feedback
title: 将外部反馈关联到项目调查与功能
createdAt: 2026-09-14T00:00:00.000Z
kind: use-case
feature: docs/feature/feedback/README.md
---

# 将外部反馈关联到项目调查与功能

维护者建立 GitHub 仓库或 Linear team 连接，导入一个 issue URL 或显式同步连接范围，浏览反馈后关联 Feature 和 Memory，编辑本地笔记并记录关闭理由。

## 主流程

1. 保存连接 ID、来源范围与凭据环境变量名。首次成功读取时持久绑定远端范围身份。
2. 明确触发导入或同步；读取在仓库写锁外完成。分页只是一次有界遍历，不承诺某一瞬间的完整快照。
3. 同一来源对象只有一条本地反馈；换连接或清空缓存后再次导入也不重复创建。
4. 在反馈详情分别查看首次来源摘录、缓存的远端观察和本地 Markdown 笔记。更新远端数据不改本地标题、正文或关闭状态。
5. 关联 Feature 或 Memory；关闭反馈仍遵守关联未关闭 Problem 的门禁。

## 验收

- GitHub 使用 REST issue ID；Linear 使用组织与 issue UUID。名称、显示编号、标题和连接 ID 都不是去重身份。
- GitHub 列出所有状态并排除 PR；Linear 包含归档项。任一页失败、GraphQL errors 或超出遍历上限均不发布部分反馈。
- 连接范围变化或读取期间项目配置变化明确失败，保留原文档。
- dry-run 不写文档和缓存。缓存可清空或损坏，持久来源、本地笔记与关系仍可读。
- 缓存不以较旧 updatedAt 覆盖较新观察；相同版本但内容不一致保留旧值并报告冲突。
- Web 与 CLI 都可创建本地反馈、配置连接、导入、同步、关联和关闭；Web 普通刷新不请求外部服务。
- 密钥值不进入项目文档、浏览器响应或诊断。测试只模拟外部 HTTP 边界，不调用真实账号。
