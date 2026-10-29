---
format: concord.document/v1
id: decided-design-migration-20261029
title: 已裁决 Design 迁入 Spec 的执行记录
createdAt: 2026-10-29T22:06:12.173Z
kind: memory
memoryKind: note
state: captured
epoch: 0
promotions: []
history: []
---

# 已裁决 Design 迁入 Spec 的执行记录（2026-10-29）

依据 decided-design-records 的裁决与宪法 C-012-7 至 C-012-10，27 个已裁决包的现行规则由 6 个文档组迁入 Spec，主 agent 集成共享页面。

- 链接边界：`SpecDependsOnDesignRecord` 合并后在本仓库为 0；迁移前该规则检出 43 条。
- G2：B0 = 725,232 B（基准 f597d19），迁移并集成后 B1 = 543,792 B，预算 543,924 B，减少 25.0%。达标前先去重项目 architecture 中与 local-sdlc、local-data-engine architecture 完全重复的段落，未删除已采用要求。
- 各组净增：A 18,900 B、B 27,003 B、C 27,682 B、D 16,603 B、E 25,775 B、F 10,096 B；C、D 超出分组预算，由 A、B 的余量覆盖。
- 主 agent 裁决：写作断句按实现（af50d88 之后的规则）写入；句点后接引号或右括号结束句子；document-packages 的一次性 NiceEval 迁移、NiceEval 专属接入映射不提升；`test annotate` 文案规定因实现自动选择标记而无从适用；不支持的平台须返回 `RepositoryAdapterUnsupportedPlatform`，实现差距登记为 Issue `adapter-unsupported-platform-code`。
- 迁移中登记的其它 Issue：`offline-switch-dual-lock`；`controlled-writing-budget-unmeasured` 在预算表改为场景格式后关闭。

经验：Claude 文档组与主 agent 共用账号额度，6 组并行时同时触到用量上限，恢复后自动续跑；共享文件按段落指定唯一责任人、由主 agent 集成，没有发生写入冲突。
