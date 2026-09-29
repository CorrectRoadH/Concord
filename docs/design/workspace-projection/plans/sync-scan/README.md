# 同步扫描

## Problem

保留工作区当前来源语义。

## Core Mental Model

每个 HTTP 请求等待乐观一致的全量扫描，来源变化后整次请求拒绝。

## Scope

现行方式无需新增持久记录或 CLI 命令，但无法满足编辑期间导航和前台延迟目标。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-owner-bytes-stay-out-of-cache) | satisfied | 不保存展示代次 | 现有行为 |
| [L2](../../LIMITS.md#l2-current-authority) | satisfied | 当前来源核验 | 现有行为 |
| [L3](../../LIMITS.md#l3-compatible-cli) | not-satisfied | 无显式共享历史入口 | C3 |
| [L4](../../LIMITS.md#l4-bounded-ownership) | satisfied | 已有进程清理 | 现有实现 |
| [L5](../../LIMITS.md#l5-honest-completeness) | satisfied | 漂移直接拒绝 | 现有行为 |
| [L6](../../LIMITS.md#l6-cache-only-workbench) | not-satisfied | Web 仍执行来源扫描 | C1、C5 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-editing-does-not-hide-workspace) | not-satisfied | 编辑会触发 409 | C1、C2 |
| [G2](../../GOALS.md#g2-cli-keeps-current-query) | partial | 当前命令保留但无历史入口 | C3 |
| [G3](../../GOALS.md#g3-writes-remain-safe) | satisfied | 当前摘要 | C4 |
| [G4](../../GOALS.md#g4-bounded-refresh) | not-satisfied | HTTP 等待全量扫描 | C5 |
