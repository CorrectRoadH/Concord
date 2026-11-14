# 统一项目治理术语表

本页定义统一项目治理的概念。[全局术语表](../../concepts.md)中的 [Spec](../../concepts.md#spec)与 [Issue](../../concepts.md#issue) 自动适用于本目录。

## Docs Work {#docs-work}

父 Agent 把一批文档工作切成互斥写集、逐项验收并统一收尾的一次运行，由 `concord docs work` 提供。每次运行有一个 run ID，状态只属于当前 worktree。

## item {#item}

Docs Work 中交给一个 Agent 的一份工作，声明目标、write 与 read 范围、依赖和要运行的检查。

## 收据 {#receipt}

`docs work check` 为一个 item 写下的检查结果，绑定 base、配置、read 与 write 的摘要。reported 与 verified 都来自 Concord 静态检查，后者核对当前输入与依赖；两者均不认证 agent 的工作质量。

## 远端写入计划 {#issue-receipt}

`issue remote preview` 签发的一次性远端写入计划，记录连接、动作、目标、payload 与远端前像的摘要，由 `issue remote apply` 消费。

旧写法：`receipt`

## 授权串 {#authorization-string}

preview 输出的 `authorize` 值，绑定动作、目标与 payload，作为当次授权传给 `--authorize`。它不是凭据。
