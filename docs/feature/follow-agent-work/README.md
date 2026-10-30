---
format: concord.document/v1
id: follow-agent-work
title: 跟随 agent 的工作
createdAt: 2026-10-30T01:49:52.946Z
kind: feature
origin: docs/roadmap/herdr-side-panel/README.md
---

# 跟随 agent 的工作

维护者监督 coding agent 时，在 agent 旁边看到它正在改动的 Spec：哪些 Feature 与 Use Case 被触及，相关测试最近是红是绿，正文里的概念是什么意思。终端里用 `concord panel` 打开侧边面板，Web 工作台提供同样内容的「跟随」入口。

## Problem

监督发生在终端里，Spec 却在另一个窗口里。agent 改了哪些文件可以从 Git 看到，但这些文件属于哪个 Use Case、保护它们的测试是否通过，要自己运行 `trace show`、`test list` 再拼起来。多个 agent 在不同 worktree 中工作时，每个都要重复一遍。

## Core Mental Model

- 关注范围：当前工作树相对 HEAD 的改动所触及的 Feature 与 Use Case。改动的 Spec 文件直接计入；改动的实现与测试源码经源码标记计入它们指向的 Spec。没有改动时，关注范围为空，面板显示全部 Feature。
- 侧边面板：`concord panel` 在终端中运行的只读界面，跟随一个工作树。Herdr 插件把它放在当前 pane 的右侧。
- 「跟随」入口：Web 工作台中与侧边面板内容相同的页面。两者对同一来源状态显示相同的关注范围、测试状态与诊断。

关注范围、测试关联与概念都从现有 owner 推导，不另存登记表。面板只读；编辑在 Web 工作台、编辑器或 CLI 中进行。

## 范围

覆盖查看、跟随与跳转。不在面板中编辑 Spec、运行测试、执行生命周期操作或审阅 diff；这些仍由 Web 工作台与 CLI 提供。面板不依赖 Herdr：任何终端都能运行，Herdr 只提供插件入口与 pane 放置。

## 使用场景

- [在终端侧边打开 Spec 面板](use-case/open-side-panel.md)
- [跟随 agent 的改动](use-case/follow-agent-changes.md)
- [查看 Use Case、测试与概念](use-case/read-spec-detail.md)
- [在 Web 工作台继续](use-case/continue-in-web.md)

## Constitution

- [C-001](../../constitution.md#c-001)
- [C-002](../../constitution.md#c-002)
- [C-014](../../constitution.md#c-014)
