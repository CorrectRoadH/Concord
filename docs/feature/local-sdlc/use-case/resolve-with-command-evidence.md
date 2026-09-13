---
format: concord.document/v1
id: resolve-with-command-evidence
title: 记录命令证据并关闭 Problem
createdAt: 2026-09-13T11:00:35.726Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 记录命令证据并关闭 Problem

## 场景

作为修复缺陷的工程师，我希望 Concord 对同一真实 case 运行仓库声明的验收命令，保存 red/green command evidence，并只在证据仍对应当前定义与 Problem epoch 时关闭问题。

## 主流程

1. active case 通过 `@concord-regression` 指向 open Problem。
2. `test run` 在消费者 cwd 以 argv、`shell=false` 和 timeout 启动进程，记录输出摘要、执行观察与清理结果。
3. 修复前普通非零退出形成 red；修复后命令成功且进程组清理完整形成 green。通用 runner 可以保留 `unknown` execution，默认 Node runner则解析 TAP 观察。
4. `memory resolve --kind fixed` 核对相同 case、契约、当前 epoch、definition digest 与当前候选摘要，并保存非空作者原因。

## 验收

- timeout、signal、启动失败、清理失败和已知 zero/skipped 不能充当有效 green；默认 Node TAP 无法可靠解析时也判为 invalid，而通用 runner 的 `unknown` 不被伪称为原生 case passed。
- 测试文件、runner 配置、sourceFiles、契约或候选实现漂移会使证据 stale。
- 收据只标为 command evidence，不声称原生逐 case 覆盖率或 formal E2E。
