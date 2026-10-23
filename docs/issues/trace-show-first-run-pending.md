---
format: concord.document/v1
id: trace-show-first-run-pending
title: 首次运行 trace show 直接返回 QueryPending
createdAt: 2026-10-23T03:12:31.363Z
kind: issue
state: draft
memoryRelations: []
adoptions:
  current: []
  history: []
history: []
---

# 首次运行 trace show 直接返回 QueryPending

## 观察

在新接入的仓库里第一次运行 `concord trace show <path>`（不带 `--fresh`），命令退出 1，返回 `QueryPending`，`details.refresh` 为 `requested`。加 `--fresh` 后正常返回。

agent 按 skill 的建议在会话开始时运行 `trace show`，第一次调用就会失败，需要读懂错误再重试。

## 待判断

- 尚无任何快照时，是否应当直接等待当前来源，而不是失败。
- 如果保留现有行为，skill 与 `local-sdlc/cli.md` 是否应在首次调用的示例里直接带 `--fresh`。

## 复现

`concord init` 后创建一份 Feature，运行 `concord trace show docs/feature/<id>/README.md`。
