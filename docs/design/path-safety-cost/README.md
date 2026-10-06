---
format: concord.document/v1
id: path-safety-cost
title: 读取路径安全检查的成本边界
createdAt: 2026-10-06T05:38:05.153Z
kind: design
alternatives:
  - anchored-root
  - realpath-compare
constitutionRefs:
  - docs/constitution.md#c-003
  - docs/constitution.md#c-014
decision:
  selected: anchored-root
  reason: 祖先以 bigint inode 与快照内根 fd 锚定，读取与写入解析分离，文件以不跟随 symlink 方式打开并 fstat 核对，Darwin 拼写只复核查过条目；独立 Opus 5.5 审查三轮 PASS。
  at: 2026-10-06T05:55:37.155Z
  targets: []
---

# 读取路径安全检查的成本边界

## Problem

每次仓库读取都调用 `assertNoSymlink`。它从文件系统根 `/` 起，对目标路径的每一级父目录先 `readdir` 核对字节精确拼写（Darwin），再 `lstat` 检查 symlink。仓库根之上的祖先目录也逐次枚举：macOS 临时目录约 1671 项，`~/Downloads` 约 104 项。目录扫描 `scanDirectory` 对每个条目再做一次完整检查。成本因此是“读取次数 × 路径深度 × 目录宽度”。

`scale` 消费者的一次刷新扫描为 147s，其中 `readdirSync` 占 139s（19.5 万次）。rpg-game 冻结副本的插桩运行中，`/private/tmp` 被枚举 24 万次，返回 4.5 亿个条目。需要决定读取路径如何在不放宽安全边界的前提下去掉这部分重复成本。

## Core Mental Model

路径检查回答两个问题：读取时路径上没有 symlink 或越界（安全），以及路径拼写与目录条目字节一致（Darwin 拼写）。前者必须在每次读取时成立；后者在快照内只要求最终可核验。仓库根之上的祖先不属于仓库，只需证明“仍是打开仓库时验证过的同一组目录”。

## Scope and Tradeoffs

只改变只读快照内的文件读取与目录扫描。写入、建目录与删除、原子替换、journal、发布 preflight 与 apply、恢复、`discoverRoot` 与 `init` 的检查保持现状，即使它们在快照内执行。比较以 inode 锚定仓库根并在快照内复用目录列表（`anchored-root`），与每次读取用 `realpath` 比较规范路径（`realpath-compare`）。

## Entry Points

- [目标](GOALS.md)
- [约束](LIMITS.md)
- [场景](CASES.md)
- [裁决](DECISION.md)
