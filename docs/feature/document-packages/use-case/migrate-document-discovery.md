---
format: concord.document/v1
id: migrate-document-discovery
title: 完整发现受管文档
createdAt: 2026-09-15T00:23:51.211Z
kind: use-case
feature: docs/feature/document-packages/README.md
---

# 完整发现受管文档

维护者打开消费仓库，从 CLI 和 Web 发现当前格式的 Engineering、Roadmap、Design 和 Research。主题由目录与严格 metadata 确定；候选、材料、索引和模板保持各自角色。

发现读取当前配置与受管来源集合。无效格式产生路径明确的诊断，结果标注不完整；不猜测已采用或已裁决状态，不转换或重写输入。嵌套 owner 截断祖先归属，材料仍可从主题树访问。

验收覆盖当前主题的完整发现、无效输入诊断、CLI 与 Web 一致性及原文保留。结构检查不产生测试执行证据。
