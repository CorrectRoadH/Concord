# unified-json

## Problem

规则的混合职责与重复条目阻碍作者理解、修改和验证写作政策。

## Core Mental Model

将禁用表达、标准术语、含义与同义词统一迁入 JSON，再从 JSON 生成概念页面。

## Scope

浏览器管理、服务端校验与检查；不负责产品 API 语义或自动正文替换。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-safe-publication) | satisfied | 固定路径、具名写入和 CAS 日志 | 架构论证，不代表验收 |
| [L2](../../LIMITS.md#l2-preserve-sources) | not-satisfied | 需要迁移概念身份和原文编辑职责 | 当前 concepts 与写作规则双来源 |
| [L3](../../LIMITS.md#l3-honest-checks) | satisfied | 只读检查，不生成执行证明 | 文档检查契约 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-clear-ownership) | satisfied | 迁移完成后 JSON 单一拥有 | 候选架构论证 |
| [G2](../../GOALS.md#g2-web-authoring) | satisfied | 显式保存、冲突保留草稿和按需检查 | 浏览器交互设计，待实测 |

## Entry Points

`/writing` 提供写作与术语入口。CLI 结构化 action 与 Web 共用领域操作。
