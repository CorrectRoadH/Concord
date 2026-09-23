---
format: concord.document/v1
id: document-packages
title: 文档目录与完整发现
createdAt: 2026-09-15T00:23:49.206Z
kind: feature
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-006
  - docs/constitution.md#c-009
---

# 文档目录与完整发现

维护者在 Concord 中看到消费仓库的完整文档主题，并以主题目录自由组织 Research。未迁移的历史 Markdown 通过显式离线迁移进入当前文档模型，不能因界面没有显示就被静默丢弃。

## 用户结果

- 文档 ID、Use Case 文件名及自定义专题支持中文等 Unicode 名称；沿用固定入口与原有归属关系，不需要另建英文副本。
- Research 以主题文件夹及 README.md 入口组织。新建时只生成标题，不要求来源、日期、章节或附页；作者可添加自己命名的 Markdown 页面。
- Research 的来源和观察日期可选，已有值、历史 provenance 与正文在迁移时保留。来源不限定为外部产品。
- Engineering、Roadmap、Design 与 Feature 的旧主题经过完整分类后可由 CLI 与 Web 发现。索引、模板、候选和材料页保持自己的角色，不伪造独立主题或采用状态。
- Template 指引、随包模板和 init 参考模板说明各自职责；Research 模板不施加内容结构。

## 迁移与验收

迁移先提供可审阅的输入集合、前像、目标路径及处理原因，再以当前共享锁和可恢复事务发布。保留未知改动；路径变化同步受影响的当前引用和实际 Markdown 链接，历史证据和审计记录不改写为新证明。迁移后核对主题数量、原文保存、CLI 查询、Web 文件树与重复执行结果。

Research 主题是决策输入，不因创建、迁移或结构检查而成为已采用契约或执行证据。
