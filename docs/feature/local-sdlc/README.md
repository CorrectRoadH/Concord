---
format: concord.document/v1
id: local-sdlc
title: 本地 SDLC 闭环
createdAt: 2026-09-13T11:00:32.576Z
kind: feature
---

# 本地 SDLC 闭环

Concord 让一个 Git worktree 用仓库内可审阅的 Markdown 与测试源码表达产品契约、可执行验收和工程记忆。它面向离线、可移植的开发流程：文档与源码是事实来源；Git-private SQLite 只保存可删除重建的缓存，命令证据与未完成事务 journal 则必须保留并按各自完整性规则处理。

## 用户价值

维护者可以从同一个 CLI 完成接入、规划、测试关联、命令证据、Memory 生命周期、追踪和审阅，不需要 NiceEval checkout、全局凭据、部署服务或第二份关系注册表。

## 范围

- 初始化项目配置、写作指南和完整参考模板，不覆盖已有文件。
- 创建并维护 Feature、Use Case、Roadmap、Design、Engineering、Research 与 Memory owner。
- 从真实测试声明旁的注释发现 case，并用 SQLite 加速可重建投影。
- 运行项目声明的 argv，签发 command 级 red/green 收据，并约束 Problem 的 fixed 关闭。
- 以路径安全、preimage、journal 和恢复协议保护本地写入。
- 从 owner 动态编译 trace，并渲染本地 review 材料。

## 非目标

Concord 不把命令收据描述成原生 runner 的逐 case 覆盖率或 formal E2E；不自动发布、push、调用付费模型或操作远端 Issue；不让 SQLite 成为不可重建的事实来源。

## 验收

七条 Use Case 均有真实 `node:test` 声明通过 `@concord-contract` 关联。`concord check` 与 `trace check` 必须验证引用完整性；定向 `trace show` 与 `review render` 必须能从当前 owner 反查这些测试。
