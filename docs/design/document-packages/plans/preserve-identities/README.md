# 保留身份并迁移目录

Research 单文件 owner 移到同名目录 README，原有目录 owner 不移动。支持页按最深合法 owner 归属；目录主题只是前端分组。新研究只有标题，可自由添加安全相对路径的 Markdown。

Engineering、Roadmap、Design 使用显式分类补齐 metadata，Design 旧 PLAN-N 目录迁到 plans/plan-n。取消、暂缓和实际选择必须保留。应用绑定完整前像并重新计算变更，通过共享锁与 journal 一次发布，精确重定向当前引用及 Markdown 链接。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-路径拥有-canonical-identity) | satisfied | 单文件迁移为同名目录 README，原有目录 owner 不移动，owner identity 继续保留。 | 原候选正文明确描述 owner 与路径策略。 |
| [L2](../../LIMITS.md#l2-现有格式与链接不可静默丢失) | satisfied | 补齐分类 metadata，迁移 PLAN-N，并精确重定向当前引用及 Markdown 链接。 | 原候选正文明确列出 metadata、目录和链接处理。 |
| [L3](../../LIMITS.md#l3-研究组织自由且不新增登记表) | satisfied | 新研究只有标题，支持页为安全相对路径 Markdown；主题从目录分组，不新增 registry。 | 原候选正文明确自由组织和目录分组语义。 |
| [L4](../../LIMITS.md#l4-保留现场并使用可恢复发布) | satisfied | 绑定完整前像，重新计算变更，通过共享锁和 journal 一次发布。 | 原候选正文明确完整前像、锁和 journal。 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-已有主题完整发现) | pending | 目录主题提供发现机制，但完整打包 CLI 与 Web 入口仍需固定场景核对。 | 裁决保留该实际验收要求，未虚构完成结果。 |
| [G2](../../GOALS.md#g2-研究正文自由组织) | satisfied | 新研究只有标题，可自由添加章节和安全相对路径 Markdown。 | 原候选正文明确该规则。 |
| [G3](../../GOALS.md#g3-保留身份来源历史与引用含义) | satisfied | 保留 owner identity、来源和历史，并精确重定向当前引用。 | 原候选正文明确身份、历史与引用处理。 |
| [G4](../../GOALS.md#g4-迁移冲突可拒绝或恢复) | pending | 方案有前像、锁和 journal 机制，但完整冲突、重复应用和恢复仍需验收。 | 裁决明确列为剩余验证。 |
| [G5](../../GOALS.md#g5-历史状态可辨认) | satisfied | 取消、暂缓和实际选择必须保留，未知裁决时间不推断。 | 原候选正文与裁决明确历史保留规则。 |
