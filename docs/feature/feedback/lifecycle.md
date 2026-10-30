# 反馈生命周期

`status: open` 且没有关系的 Issue 显示「待处理」；带有任一关系显示「已关联」；`status: closed` 显示「已关闭」。这三个展示状态从当前字段推导，不额外持久化一份 triage 字段。

来源的 Open、Done、Closed 等状态只描述上一次远端观察，同步不关闭本地 Issue。本地关闭按[关闭种类](use-case/manage-local-observations.md#操作-spec)写入结论；fixed 关闭前经过[修复核验](../../constitution.md#c-004-2)，结论写入 `closure.verification`。

来源摘录与本地笔记分开；用户对标题和正文的编辑不会被重复同步覆盖。远端移出列表、连接删除、缓存清空都不删除本地观察。多个反馈可指向同一个 Memory 或 Spec，无需按相似标题自动合并。
