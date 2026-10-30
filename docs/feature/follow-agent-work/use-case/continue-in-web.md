---
format: concord.document/v1
id: continue-in-web
title: 在 Web 工作台继续
createdAt: 2026-10-30T01:50:59.141Z
kind: use-case
feature: docs/feature/follow-agent-work/README.md
---

# 在 Web 工作台继续

维护者在面板中看到需要修改的 Spec，在 Web 工作台中打开同一个条目继续编辑。

## 主流程

1. 在面板中选中 Feature、Use Case、测试或概念，按 `o`。
2. 浏览器打开 Web 工作台中的同一条目。Web 工作台尚未运行时由面板启动，地址同时显示在面板中。
3. 维护者在 Web 中编辑并保存；面板在一秒内显示新内容。
4. 维护者也可以直接在 Web 工作台的「跟随」入口中跟随 agent，不打开面板。

## 验收

- `o` 打开的是同一条目的深链接：Use Case 打开所属 Feature 并展开该 Use Case，测试打开其源码位置，概念打开所属 `concepts.md` 中的定义。
- 没有可用浏览器时（例如 SSH 会话），只显示地址，不报告失败。由面板启动的 Web 工作台只监听本机回环地址，遵守 Web 工作台的信任边界。
- 面板与 Web 对同一来源状态显示相同的关注范围、测试状态与诊断。
- 面板退出不关闭由它启动且仍有浏览器连接的 Web 工作台。
