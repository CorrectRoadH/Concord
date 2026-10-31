---
status: closed
closure:
  kind: fixed
  reason: execution 以 ran/none 表示数量，与退出码独立；red 与 green 均在冻结提交的临时检出中核验
  verification:
    defect: 209389d3f5cc5965659a65e3c6b48b226a8e8ace
    fix: 3a5209fd45ebc09f61ab714cf8977d8c7fa80873
    tests:
      - neref_3b11763e77bb20c1fe7f67b9ac53bfa6
    runner: sha256:fd7da6b6c34baad208a76243f3aa97f42871a0a1629cabfe2716d3baa25ad6b6
    concord: dev
---

# 命令收据的 execution 取值 nonzero 容易误读

## 观察

`concord --json test run` 的通过收据同时出现 `"execution":"nonzero"` 与 `"exitCode":0`。`nonzero` 实际表示执行的测试数大于 0（`src/evidence.ts` 中 `pass + failed > 0`），与退出码无关。

人和 agent 读到 nonzero 时会先联想到非零退出码，于是判断这份通过收据自相矛盾。`commandOutcome` 与 `exitCode` 已经表达退出结果，`execution` 需要一个只描述执行数量的取值名。

## 决定

`execution` 的取值改为 `ran`、`none`、`skipped` 与 `unknown`，见 [CLI 页](../feature/local-sdlc/cli.md)。`test run` 的结果不保存，修复核验记录在 Issue 中，没有需要迁移的已保存收据。

## 复现

在任意接入仓库对一个通过的测试运行 `concord --json test run <case-id>`。
