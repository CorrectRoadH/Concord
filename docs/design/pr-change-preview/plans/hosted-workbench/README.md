# 托管工作台

## Problem

将 Concord 本地服务部署到 PR 环境，直接复用完整导航与阅读能力。

## Core Mental Model

服务器持有 Git checkout 和工作区服务，读者通过 HTTP 使用工作台。公开托管必须重新定义访问身份、只读能力与进程所有权。

## Scope

复用完整 UI 的收益伴随在线服务、认证和资源回收成本，超出只读提交审阅的目标。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
|---|---|---|---|
| [L1](../../LIMITS.md#l1-公共阅读不授予本地能力) | not-satisfied | 本地 API 允许编辑与执行，隐藏按钮不能隔离权限 | [现有信任边界](../../../../feature/web-workbench/architecture.md) |
| [L2](../../LIMITS.md#l2-产物绑定明确输入) | pending | 需增加冻结提交模式并阻止工作树漂移 | C1、C2 |
| [L3](../../LIMITS.md#l3-独占输出并保留未知文件) | pending | 需管理 checkout、服务、任务与部署生命周期 | C5 |
| [L4](../../LIMITS.md#l4-可安装且有界) | pending | 可安装，但消费者需 Node 服务与运行资源 | C5 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
|---|---|---|---|
| [G1](../../GOALS.md#g1-正确识别-pr-的改动) | pending | 当前服务比较工作树，需新增冻结基线 | C1、C2 |
| [G2](../../GOALS.md#g2-直接阅读文件和文档) | satisfied | 复用已有文档导航与差异组件 | [工作台契约](../../../../feature/web-workbench/README.md) |
| [G3](../../GOALS.md#g3-消费者接入简洁) | not-satisfied | 静态托管不足以运行带执行能力的服务 | 服务信任与资源边界 |
