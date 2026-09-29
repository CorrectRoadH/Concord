# Web 专属投影

## Problem

使 Web 导航避开请求内全量扫描。

## Core Mental Model

服务刷新并持久保存结构投影；CLI 不提供查看同一代次的入口，继续只做当前扫描。

## Scope

与共享方案具有相同的正文隔离、编辑安全和后台刷新成本，CLI 无法核对 Web 看到的代次。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-owner-bytes-stay-out-of-cache) | satisfied | 结构记录 | 方案推演 |
| [L2](../../LIMITS.md#l2-current-authority) | satisfied | 定向编辑前像 | 方案推演 |
| [L3](../../LIMITS.md#l3-compatible-cli) | not-satisfied | 无显式 CLI 历史入口 | C3 |
| [L4](../../LIMITS.md#l4-bounded-ownership) | pending | 服务单刷新 | 待验证 |
| [L5](../../LIMITS.md#l5-honest-completeness) | pending | 同共享方案 | 待验证 |
| [L6](../../LIMITS.md#l6-cache-only-workbench) | satisfied | Web 只读缓存 | 方案推演 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-editing-does-not-hide-workspace) | pending | 旧代次可读 | C1、C2 |
| [G2](../../GOALS.md#g2-cli-keeps-current-query) | not-satisfied | CLI 无法看 Web 代次 | C3 |
| [G3](../../GOALS.md#g3-writes-remain-safe) | pending | 定向前像 | C4 |
| [G4](../../GOALS.md#g4-bounded-refresh) | pending | 单 owner | C5 |
