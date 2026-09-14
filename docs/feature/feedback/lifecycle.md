# 反馈生命周期

本地未关闭且没有关联的反馈显示「待处理」；已有 Feature 或 Memory 关联显示「已关联」；`state: closed` 显示「已关闭」。这三个展示状态从当前 owner 推导，不额外持久化一份 triage 字段。

来源的 Open、Done、Closed 等状态只描述上一次远端观察。同步既不关闭本地反馈，也不把 Problem 记为 fixed。本地关闭须说明理由；仍关联 open Problem 时先处理该 Problem。修复证明继续通过 Concord 自己签发的 command evidence 校验。

来源摘录与本地笔记分开；用户对标题和正文的编辑不会被重复同步覆盖。远端移出列表、连接删除、缓存清空都不删除本地观察。多个反馈可指向同一个 Memory 或 Feature，无需按相似标题自动合并。
