---
format: concord.document/v1
id: organize-freeform-research
title: 自由组织研究主题
createdAt: 2026-09-15T00:23:50.194Z
kind: use-case
feature: docs/feature/document-packages/README.md
---

# 自由组织研究主题

维护者从 Web 或 CLI 新建一个研究主题，填写名称与标题后立即进入主题 README。未填写来源、观察日期、正文或附页时，创建仍成功，README 仅含标题，没有研究提纲或示例正文。

维护者添加自行命名的 Markdown 页面，用自己的章节、链接和目录组织材料；刷新后主题及其页面仍可发现。页面在主题文件树内编辑，完整文件摘要保护并发编辑；越界路径、同名冲突及抢占其它主题的写入被拒绝。已有独立主题的身份和 provenance 不因显示分组被合并。

验收从打包 CLI 和真实浏览器创建、添加页面、保存和刷新，核对实际文件路径、内容与列表归属。元数据结构检查不要求正文使用特定章节。
