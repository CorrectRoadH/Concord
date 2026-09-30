---
format: concord.document/v1
id: release-preview-cache-retry
title: PR 预览发版前的缓存占用回归
createdAt: 2026-09-30T07:07:13.927Z
kind: memory
memoryKind: insight
state: current
epoch: 0
promotions: []
history: []
---

# 缓存占用与浏览器验收

已加载工作台收到 WorkspaceProjectionUnavailable/HawdbBusy 时，原先仅按普通轮询间隔重读缓存。短暂句柄占用因此使工作台长时间停在不可用提示。现与首次加载一致，每两秒重试缓存 GET，保留草稿，不额外请求扫描或回源。

浏览器回归通过 HTTP 边界制造占用，再核验恢复导航且扫描请求数不增加。storage 与 p5 的旧断言已按任意 docs Markdown 编辑及异步导航契约更新；连续保存测试在回读前像完成后才引入下一次外部冲突。

2026-09-30 本地 pnpm check：340 项，338 通过、0 失败、2 跳过。包含构建、类型检查、隔离安装包和浏览器验证。该结果不代表后续 GitHub Release 或 NiceEval 线上部署已完成。
