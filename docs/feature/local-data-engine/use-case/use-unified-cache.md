---
format: concord.document/v1
id: use-unified-cache
title: 使用统一的可重建持久缓存
createdAt: 2026-09-23T04:17:21.113Z
kind: use-case
feature: docs/feature/local-data-engine/README.md
---

# 使用统一的可重建持久缓存

用户在隔离 Git 消费者中安装打包后的 Concord，执行 scan、code scan、反馈列表及 cache status/rebuild/clear。注解、代码、配置和远端快照使用同一 HawDB 目录，彼此以命名空间隔离。

连续命令可以命中缓存；编辑、新增或删除来源立即使对应键失效。数据库缺失、损坏、被其他进程占用或 payload 不合 Schema 时，源码解析回源并报告缓存状态；远端快照失败不触发网络请求，不覆盖已捕获的本地 Issue。一次完整远端 fetch 的合并具备事务原子性、单调时间戳及同版本冲突保护。

clear 只删除当前缓存及显式列出的旧缓存残留，拒绝 symlink、越界和活动句柄；重建后来源内容和证据摘要不变。旧 SQLite 不被自动读取或转换成事实；删除前保留可审阅路径。CLI 和长期运行的 Web 之间不持有命令全程数据库锁，不让空闲 Web 独占缓存。

验收覆盖缓存冷热命中、损坏、陈旧 payload、重复进程、事务失败、强制中断后重开、clear 与 dry-run、安全路径、无 SQLite 运行时导入，以及离线安装打包 CLI 后的实际操作。
