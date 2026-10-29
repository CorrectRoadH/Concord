---
format: concord.document/v1
id: design-constitution-refs-edit
title: Design 创建后无法追加 constitutionRefs
createdAt: 2026-10-21T09:25:34.618Z
kind: issue
state: closed
memoryRelations: []
adoptions:
  current: []
  history: []
closure:
  kind: closed
  reason: 依据关系改由正文链接拥有，constitutionRefs 已取消；用 author set、page set 或 issue edit 修改链接即可增删引用
history:
  - at: 2026-10-29T02:34:40.967Z
    action: close
    reason: 依据关系改由正文链接拥有，constitutionRefs 已取消；用 author set、page set 或 issue edit 修改链接即可增删引用
---

# Design 创建后无法追加 constitutionRefs

`constitutionRefs` 只能在 `feature create` 或 `design create` 时通过 `--constitution-ref` 声明。定案前的审查发现新的适用条款时，没有受管命令可以追加或删除条款引用，而 metadata 不允许手工编辑。

观察实例：`docs/design/test-journey-steps` 的 rename-step 发布规则需要引用 C-003，只能在候选正文中链接条款，反向影响视图不包含该 Design。
