---
format: concord.document/v1
id: evidence-execution-naming
title: 命令收据的 execution 取值 nonzero 容易误读
createdAt: 2026-10-23T03:12:30.303Z
kind: issue
state: draft
memoryRelations: []
adoptions:
  current: []
  history: []
history: []
---

# 命令收据的 execution 取值 nonzero 容易误读

## 观察

`concord --json test run` 的通过收据同时出现 `"execution":"nonzero"` 与 `"exitCode":0`。`nonzero` 实际表示执行的测试数大于 0（`src/evidence.ts` 中 `pass + failed > 0`），与退出码无关。

人和 agent 读到 nonzero 时会先联想到非零退出码，于是判断这份通过收据自相矛盾。`commandOutcome` 与 `exitCode` 已经表达退出结果，`execution` 需要一个只描述执行数量的取值名。

## 影响

`execution` 是 `concord.command-evidence/v1` 的公开 JSON 字段。改名会影响已保存的收据与读取它们的消费者，需要先写方案并经独立审查。

## 复现

在任意接入仓库对一个通过的测试运行 `concord --json test run <case-id>`。
