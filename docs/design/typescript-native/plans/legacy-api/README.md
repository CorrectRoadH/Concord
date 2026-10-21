# 保留旧编译器 API

## Problem

保留旧编译器作为解析依赖可以减少调用改动。

## Core Mental Model

构建升级至原生版本，运行时另装旧 JS 编译器。两套语义与版本独立维护。

## Scope

此方案保留纯内存旧 AST，但不满足单一版本与新语义要求。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-bounded-authority) | satisfied | 现有受限 host | 既有实现边界 |
| [L2](../../LIMITS.md#l2-public-delivery) | not-satisfied | 双编译器掩盖运行时迁移 | 本方案定义 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-native-compiler) | partial | 仅构建升级 | 本方案定义 |
| [G2](../../GOALS.md#g2-equivalent-behavior) | pending | 原有行为仍需重验 | C1–C6 |
