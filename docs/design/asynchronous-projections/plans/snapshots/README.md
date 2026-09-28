# 异步投影与乐观读取

## Problem

查询与写入需要明确的并发边界。

## Core Mental Model

读取通过来源观察和发布代次检测变化；查询投影异步刷新；写入提交串行化。

## Scope

来源文件与证据保持权威，缓存不成为授权来源。

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-nonblocking-queries) | satisfied | 完整投影读取与异步刷新 | [架构](architecture.md) |
| [G2](../../GOALS.md#g2-concurrent-preparation) | satisfied | 独占范围限于提交 | [架构](architecture.md) |

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-preserve-authority) | satisfied | 前像、journal 与证据门禁 | [架构](architecture.md) |
| [L2](../../LIMITS.md#l2-bounded-resources) | satisfied | 有界 HawDB 与资源所有权 | [架构](architecture.md) |
