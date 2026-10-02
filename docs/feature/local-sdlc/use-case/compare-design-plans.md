---
format: concord.document/v1
id: compare-design-plans
title: 逐项比较方案并明确裁决
createdAt: 2026-09-20T10:00:00.000Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 逐项比较方案并明确裁决

## 场景

作为 Design 作者，我需要用同一组 Goals 和 Limits 比较所有候选，知道每个候选满足哪些要求，并在 DECISION 中明确选择。

## 主流程

1. 创建 Design，生成 GOALS、LIMITS、DECISION、CASES 和每个候选 README。
2. GOALS 和 LIMITS 使用一个 H1 文件标题，每条要求为 H2 `G1：标题` 或 `L1：标题`；编号稳定且唯一。正文说明目标/约束、来源和判定条件。引用使用条目实际标题的 Markdown anchor。
3. 每个候选入口的 `## Limits` 和 `## Goals` 各有一张四列表格：要求链接、结论、满足方式或缺口、依据。每条要求恰好回应一次，不能只列成功项。Limits 支持 satisfied/not-satisfied/pending（满足/不满足/待验证）；Goals 还支持 partial（部分满足）。依据可以是设计论证或实际验证材料，必须说明实际证明范围。
4. DECISION 的 `## Decision` 声明一个直接候选入口链接，例如 `选择 [plan-2](plans/plan-2/README.md)。`；未选择写“未定案”。`## Rationale` 解释比较和接受的 Goal 缺口，`## Rejected Options` 说明否决原因，`## Residual Risks` 说明遗留风险。作者正文不能替代 metadata 中的正式裁决。
5. `design check` 报告结构、遗漏、重复、引用、状态和选择冲突；`design decide` 在同一校验通过且所选候选每条 Limit 均满足后记录唯一裁决。其他候选可以不满足约束。Goal 缺口必须显式出现在裁决依据中。
6. 已有裁决的理由可通过 `design correct-reason` 更正。作者提供当前 Design 与 Memory 摘要、新理由和更正说明；Design 必须与 Git HEAD 中的版本一致。命令原子更新理由并在指定的受管 Memory 追加原文提交、摘要、更正时间和说明，不改变选择、目标、定案时间或来源，不重新运行定案门槛。Memory 承载更正过程，Design 保持声明式。
7. `design format` 只规范已识别的 H2 标题和四列表格空白；支持 dry-run 和现有 publication 前像保护，不补选择、结论、理由或证据。保留原有换行风格、标题锚点和代码块，格式化成功不等于校验通过。

## 异常与验收

- 缺项、重复 ID、错误层级、未知状态、空解释、错误链接和选择不一致均有具名 finding；代码块、引用块和 HTML 中的伪表格不作为声明。
- 未定案草稿允许编辑和保存；正式定案检查全部候选的回应完整性。所选候选的硬约束不满足或待验证时零写入失败。
- CLI、结构化 action/Web 及 repository 定案入口执行同一内容规则。读取的 GOALS、LIMITS、DECISION 和所有候选入口、支持 Markdown 及 plans 目录集合发生漂移时阻止发布，dry-run 也完整校验。
- 历史已定案文件保留原内容与含义；普通读取及全局完整性检查不追溯施加新写作门槛。显式 design check 对当前正文给出新规则诊断，不把历史 metadata 或模板当作验证证据。
- 理由更正拒绝不存在的裁决、未提交的 Design、相同或空白的新理由、非当前 Note/Decision Memory 及任一过期摘要；dry-run 执行相同校验且不写入。原理由可由 Memory 记录的 Git 提交和摘要找回。
- 使用构建及打包后的公开 CLI 在隔离 Git 消费者验证创建、检查、格式化、拒绝定案和成功定案。结构检查不能证明方案在现实中满足目标或约束。

## 候选内容布局

候选名称由 alternatives 唯一声明。入口为 `plans/<name>.md` 或 `plans/<name>/README.md`；默认创建目录形式。文件与同名目录（含空目录）同时存在返回 AmbiguousDesignPlan，缺少入口返回 DesignPlanNotFound。README 为保留候选名称，不区分大小写。未声明的直接子项、名称碰撞、symlink 和错误文件类型拒绝。

Plan 文件的要求链接相对上一级 Design 根，目录 README 的要求链接相对上两级。DECISION 链接必须指向实际入口。单文件与目录可以在同一 Design 混用。已定案后的组织形式调整不修改 decision metadata，作者负责更新 DECISION 和所有精确引用。

目录候选支持 `concord design page add <design> 存储/快照.md --plan <name>`，show/set 使用相同路径并校验摘要。单文件候选添加支持页返回 DesignPlanRequiresDirectory。子目录 README 是普通页面，不新增 owner。外层页面不得通过 plans 路径绕过候选选择。支持页面及 anchor 解析到所属 Design，不扩大测试或实现标记的目标种类。

定案把额外 Markdown 作为同内容 guard，因此这些页面进入 changedPaths。附件由消费项目生成，Concord 不因扫描执行源码，不声称附件内容构成裁决证据。目录入口唯一性在 CLI、action、repository 和工作台采用同一解释。
