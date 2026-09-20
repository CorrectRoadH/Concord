# 裁决

## Decision

Selected: [annotations](plans/annotations/README.md)

## Rationale

采用声明旁的路径注释，形式为 `// @feature <路径>` 或 `// @use-case <路径>`。不要求人工测试 ID 或前置关联步骤。它保留测试名称的行为语义，并由工具自动生成执行引用。

G1: annotations 明确保留自然语言测试名称；原文支持该目标。

G2: annotations 直接以 `@feature` 或 `@use-case` 指向 canonical 契约；原文支持该目标。

G3: annotations 由 native 文件、声明文件及名称派生执行引用，无需作者维护 ID；原文支持该目标。

独立设计挑战已审阅直接契约绑定、原生唯一对应和证据归属边界。实现依照用户后续指示删除旧格式支持，不添加旧格式拒绝测试；验证覆盖现行行为。该设计记录保留原有事实，不把命令收据扩大为正式执行证明。

## Rejected Options

title-token 会在测试标题中附加机器 ID，污染测试名称和报告，且需要作者手动维护；最终选择路径注释。

## Residual Risks

原文仅说明当前行为和验证范围，真实消费仓库迁移与正式 native 执行仍归消费仓库负责，尚需另行完成；Concord 静态发现不能替代该验收。
