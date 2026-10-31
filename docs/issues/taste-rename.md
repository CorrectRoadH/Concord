---
status: open
---

# 宪法改名为品味，并重组为品味与底线

## 请求

维护者决定把宪法功能改名为品味，并把内容重组为品味与底线。现行[宪法](../constitution.md)多数条款在规定机制，只说不准做什么，没有说清这个项目认为什么是好的。

## 已定的契约

- 名称：功能、文件、命令、action、错误码与术语统一为品味（taste）。文件为 `docs/taste.md`，命令为 `concord taste show|adopt|amend`，action 为 `taste.show`、`taste.adopt`、`taste.amend`。
- 错误码：`Constitution` 前缀改为 `Taste`，例如 `TasteDecisionRequired`、`TasteLinkInvalid`；`ConstitutionClauseInvalid` 与 `ConstitutionClauseReferenced` 改为 `TasteEntryInvalid` 与 `TasteEntryReferenced`。
- 结构：总则（`general-*`）、品味 `T-1` 至 `T-8`、底线 `B-1` 起。品味写它解决的问题与好坏对照，没有款；底线每款一项“必须 / 不得”。
- 品味：读得懂胜过写得全；一个词一个意思；一件事只写一次，其余推导；写现在，不写过去；只声称证明过的；文件是界面，命令只是助手；快到每次都愿意跑；规则少而硬，机制留给实现。
- 底线：现行 C-002、C-003、C-005（不含第 4 款）、C-006、C-007 与 C-015。
- 移出的条款原文进入所属页面的小节：事实归属、页面职责、只写当前声明、Design 记录与术语与语言进入 `docs/document-model.md`；当前格式与操作依赖进入 `docs/architecture.md`；源码关联进入 local-sdlc 的 `library.md`；证据范围进入 local-sdlc 的 `scope.md`；缓存与原生边界进入 local-data-engine 的 architecture 页；接入项目的范式进入 project-onboarding 的 README；性能约束进入工程页 `performance.md`。

## 需要的工具规则

已裁决的 Design，以及 Research、Issue 与 Memory 这些记录，可以保留指向已移除品味条目或旧文件的链接与 `amends` 关系，按记录时的含义理解，`check` 不报告。Spec 页面中的这类链接仍报告 `AnchorNotFound`。没有这条规则，约 30 个已裁决 Design 中的 260 处链接会阻止条款移出与改名。

## 顺序

P3 验收后分派实现：先实现改名与上述工具规则，再在同一变化中迁移本仓库的文件、链接与旧修订记录的关系目标。重写正文与可重放的迁移脚本已在本机准备，交付时随实现一起提交。
