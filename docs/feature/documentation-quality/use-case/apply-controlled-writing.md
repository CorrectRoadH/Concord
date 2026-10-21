---
format: concord.document/v1
id: apply-controlled-writing
title: 应用受控写作规则
createdAt: 2026-10-21T09:27:55.112Z
kind: use-case
feature: docs/feature/documentation-quality/README.md
---

# 应用受控写作规则

## 场景

作为文档维护者，我希望程序性文本与描述性文本使用不同的句长上限，中文与英文分别计数，并可以选择启用受控动作词、批准词与被动形式检查。

## 主流程

1. 运行 `concord writing migrate --path <policy>` 把 `concord.writing/v2` 政策显式迁移为 `concord.writing/v3`。普通入口遇到 v2 返回 `WritingMigrationRequired`。
2. 在政策的 `controlled` 对象中声明阈值、词表与开关，按目录作用域合成。
3. `concord docs check` 与 `concord check` 同时执行字符长度路径与 controlled token 路径。

## 验收

- Schema、目录合成、文本抽取、分句、计数、词表匹配、错误与受影响入口见[采用设计](../../../design/controlled-writing/plans/policy-rules/architecture.md)。
- 词法规则默认关闭；finding 只陈述观察到的词面。
- Concord 不分发 ASD-STE100 原文或词典，不宣称符合该规范，见 [Research](../../../research/ste-writing-rules/README.md)。
- 性能预算按[采用设计](../../../design/controlled-writing/plans/policy-rules/architecture.md#性能预算)测量，测量结果记入 Memory。
- 验收场景见 [CASES](../../../design/controlled-writing/CASES.md)。
