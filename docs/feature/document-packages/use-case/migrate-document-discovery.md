---
format: concord.document/v1
id: migrate-document-discovery
title: 补齐历史文档发现
createdAt: 2026-09-15T00:23:51.211Z
kind: use-case
feature: docs/feature/document-packages/README.md
---

# 补齐历史文档发现

维护者打开已有 NiceEval 消费仓库，发现原有 Engineering、Roadmap 和 Design 未完整出现在界面中。离线迁移先盘点全部主题、候选、材料、索引、模板及归档，产出路径和内容可核对的计划。

执行计划前重新核对仓库 HEAD、配置和完整输入集合。若出现未知变动、目标冲突或无法判定的语义，拒绝发布并保留现场；不会猜测已采用或已裁决状态。计划中的一次发布保留原文、已有身份、日期来源和历史，并补齐当前格式与必要引用。

发布后从同一 CLI 与 Web 发现所有应当独立展示的主题，材料仍可从主题树访问。重复应用验证结果而不重复迁移；中断可按具名恢复协议恢复。历史命令和正式测试证据不由迁移重新签发。
