---
format: concord.document/v1
id: inherit-template-defaults
title: 按项目默认值创建功能文档
createdAt: 2026-09-14T13:53:33.750Z
kind: use-case
feature: docs/feature/project-onboarding/README.md
---

# 按项目默认值创建功能文档

## 用户目标

维护者初始化时选择 Library 与 CLI，之后创建功能时自动取得适合的页面，同时允许单个功能调整。

## 完整路径

1. 项目配置保存默认页面选择。
2. 创建 Feature、Roadmap 或 Design 候选时，省略页面输入采用项目默认值。
3. 显式页面输入覆盖默认值；能明确表达仅 README。
4. 修改默认值后新建文档采用新值，已有文档不被批量重写。

## 可观察验收

README 必需；仅生成选定页面，入口链接与文件一致。Library 与 CLI 可以共存。无配置的既有消费者保留原有行为。参考模板和可执行模板配置的边界必须明确，不把 docs/_template 的普通编辑悄悄解释为生效配置。

## 契约来源

[目标与范围](../README.md)。实现与验收状态见 Feature；测试关系从真实声明派生。
