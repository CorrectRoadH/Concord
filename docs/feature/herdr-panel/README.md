---
format: concord.document/v1
id: herdr-panel
title: 在 Herdr 面板中查看 Spec
createdAt: 2026-10-30T01:49:52.946Z
kind: feature
origin: docs/roadmap/herdr-side-panel/README.md
---

# 在 Herdr 面板中查看 Spec

Concord 提供一个 Herdr 插件，在终端 pane 中打开只读的 Spec 面板。维护者不用离开终端，就能像在 Web 工作台中一样读到 Spec 的内容：Feature 正文、Use Case 的主流程与验收、关联的实现与测试、测试最近的状态，以及概念的定义。

## Problem

维护者在 Herdr 里监督 coding agent，Spec 却只能在浏览器的 Web 工作台里读，或者用 `feature show`、`trace show` 读 CLI 的结构化输出。前者要离开终端，后者是给 agent 的格式，读不到成段的正文。

## Core Mental Model

- Spec 面板：`concord panel` 在终端中运行的只读界面，打开一个工作树。Herdr 插件把它放在当前 pane 的右侧。
- 面板与 Web 工作台读取同一份工作区投影与同一套 owner，同一来源状态下显示相同的条目、关系、测试状态与诊断。
- 面板只读；编辑在 Web 工作台、编辑器或 CLI 中进行，面板可以直接在 Web 中打开当前条目。

## 范围

覆盖 Feature、Use Case、Engineering、Design 与 `docs/` 下其它文档的阅读，以及实现、测试与概念的查看。不在面板中编辑、运行测试、执行生命周期操作或审阅 Git 变更。面板不依赖 Herdr：任何终端都能运行 `concord panel`，Herdr 只提供插件入口与 pane 放置。

## 使用场景

- [在 Herdr 中打开 Spec 面板](use-case/open-side-panel.md)
- [阅读 Use Case、测试与概念](use-case/read-spec-detail.md)
- [在 Web 工作台继续](use-case/continue-in-web.md)

## Constitution

- [C-001](../../constitution.md#c-001)
- [C-002](../../constitution.md#c-002)
- [C-014](../../constitution.md#c-014)
