---
format: concord.document/v1
id: workspace-refresh-false-failure
title: 工作区刷新误报刷新失败
createdAt: 2026-09-30T08:25:13.180Z
kind: memory
memoryKind: insight
state: current
epoch: 0
promotions: []
history: []
---

# 工作区刷新误报“最近刷新失败”

现象：编辑仓库期间，工作台持续提示“最近刷新失败，当前来源状态未知”，偶发 503 `WorkspaceProjectionUnavailable`。

根因：
- 扫描期间来源漂移、保留上一致代次时，写入了 `WorkspaceProjectionDrift` error，status 变为 refresh-failed。编辑本身就会触发。
- 每次读取都重新哈希安装目录全部 JS 与 native 产物（约 60ms）；重建 `dist` 时身份变化，候选被 `WorkspaceProjectionIdentityChanged` 丢弃并记为失败，30 秒内不重试。
- `HawdbBusy` 的短暂锁冲突被写成 `Concord view error` 日志，前端已会自动重试。

处理：漂移保留只记入 lastAttempt；身份变化后立即以新身份重刷；安装身份在进程内计算一次；HawdbBusy 与 Pending 不写错误日志。PROTOCOL 已同步。
