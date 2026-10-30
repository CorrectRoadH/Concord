---
format: concord.document/v1
id: document-packages
title: 文档目录与完整发现
kind: feature
---

# 文档目录与完整发现

维护者在 Concord 中看到消费仓库的完整文档主题，并以主题目录自由组织 Research。主题由路径与 README 的一级标题确定（[领域与数据所有权](../local-sdlc/library.md#owner)）；无法读取的受管输入产生诊断和不完整状态，保留原文件。

## 用户结果

- 目录名、Use Case 文件名及自定义页面支持中文等 Unicode 名称；沿用固定入口与归属关系，不需要另建英文副本。
- Research 以主题文件夹及 README.md 入口组织。新建时只生成标题，不要求来源、日期、章节或附页；作者可添加自己命名的 Markdown 页面。
- Research 的来源和观察日期可选，写在正文的「来源」小节，格式由写作模板固定；正文由作者维护。来源不限定为外部产品。
- Engineering、Roadmap、Design 与 Feature 按路径由 CLI 与 Web 发现。索引、模板、候选和材料页保持自己的角色，不伪造独立主题或采用状态。
- Template 指引、随包模板和 init 参考模板说明各自职责；Research 模板不施加内容结构。

## 发现与验收

CLI 和 Web 使用同一文档发现规则。验收核对主题数量、原文保存、CLI 查询、Web 文件树、嵌套 owner 边界及无效输入诊断。发现不转换文件，不补写身份或状态。

Research 主题是决策输入，不因创建或结构检查而成为已采用 Spec 或执行证据。

Design 候选按内容规模使用 `plans/<name>.md` 或 `plans/<name>/README.md`，候选名称是唯一身份（[决策依据](../../design/plan-content/DECISION.md)）。目录归属与入口解析见[架构](architecture.md)。

## Constitution

- [C-001](../../constitution.md#c-001)
- [C-003](../../constitution.md#c-003)
- [C-004](../../constitution.md#c-004)
- [C-006](../../constitution.md#c-006)
- [C-009](../../constitution.md#c-009)
