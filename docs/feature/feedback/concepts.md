# 来源与工程知识术语表

本页定义反馈来源的概念。[全局术语表](../../concepts.md)中的 [Issue](../../concepts.md#issue)、[Memory](../../concepts.md#memory) 与 [Spec](../../concepts.md#spec) 自动适用于本目录。

## Provider {#provider}

观察产生的来源类别，包括 Local、GitHub 和 Linear。

## 连接 {#connection}

外部来源的读取配置，声明远端范围和凭据环境变量名。

Local 不需要连接。第三方来源的本地笔记与远端对象分别拥有状态；关闭本地 Issue 不等于远端已关闭。
