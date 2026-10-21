---
format: concord.document/v1
id: link-tests-to-steps
title: 把测试关联到 Use Case 步骤
createdAt: 2026-10-21T09:27:52.349Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 把测试关联到 Use Case 步骤

## 场景

作为测试维护者与 reviewer，我希望把测试和实现关联到 Use Case 主流程中的一个具体步骤，看到每个步骤由哪些测试与代码声明关联，并发现没有关联的步骤。

## 主流程

1. 作者在主流程的根有序列表项第一段末尾写 `{#id}`，或运行 `concord use-case format <use-case>` 为已含 ID 的列表补齐缺失 ID。为未标记列表建立步骤时，先运行 `concord use-case steps <use-case>` 查看列表，再使用 `--seed --list <ordinal>` 显式选择一个列表。 {#declare-steps}
2. 测试写 `@use-case <path>#<id>`，实现写 `@concord-implements <path>#<id>`。`concord check` 校验步骤位置、ID 命名空间与引用目标；已有标题 anchor 和整个 Use Case 的关联继续有效。 {#link-declarations}
3. `concord use-case steps <use-case>`、`trace show` 与 `review render` 按步骤列出测试与代码声明，另列整个 Use Case 和非步骤 anchor 的关联。没有关联的步骤单独列出；`trace gaps` 提示含未标记项的根有序列表。 {#inspect-associations}
4. 步骤改名使用 `concord use-case rename-step <use-case> <old-id> <new-id>`，在一个可恢复的变更集中改写正文、源码标记与 Markdown 链接。`--dry-run` 预览同一规划与校验；受管引用须先由其生命周期命令处理。 {#rename-step}

## 验收

- 步骤语法、ID 规则、命名空间与引用兼容规则遵守[共同身份](../../../design/test-journey-steps/共同身份.md#步骤语法)。
- 测试关联 ID 保持 `concord.test-reference/v1`；指向步骤与指向整个 Use Case 的标记都有效。
- 步骤视图与“无关联”列表不产生 finding，不证明执行或覆盖率。
- `format` 与 `rename-step` 的分配、选择、改写范围与发布恢复规则见[采用设计](../../../design/test-journey-steps/plans/step-anchor/architecture.md#书写与维护工具)。
- 验收场景见 [CASES](../../../design/test-journey-steps/CASES.md)，以构建打包后的 CLI 在隔离 Git 消费者中验证。
