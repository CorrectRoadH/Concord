# 共享读取租约

## Problem

查询与写入需要明确的并发边界。

## Core Mental Model

读取持有共享租约，写入等待所有读者退出。

## Scope

来源文件与证据保持权威，缓存不成为授权来源。

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-nonblocking-queries) | not-satisfied | 长扫描仍阻塞写入 | [架构](architecture.md) |
| [G2](../../GOALS.md#g2-concurrent-preparation) | not-satisfied | 写规划占用独占租约 | [架构](architecture.md) |

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-preserve-authority) | satisfied | 前像、journal 与证据门禁 | [架构](architecture.md) |
| [L2](../../LIMITS.md#l2-bounded-resources) | satisfied | 有界 HawDB 与资源所有权 | [架构](architecture.md) |
