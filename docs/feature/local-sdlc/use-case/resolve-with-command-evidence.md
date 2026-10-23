---
format: concord.document/v1
id: resolve-with-command-evidence
title: 记录命令证据并关闭 Problem
createdAt: 2026-09-13T11:00:35.726Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 记录命令证据并关闭 Problem

## 用户目标

修复缺陷的工程师要证明修复确实生效：同一个测试在修改产品代码之前失败，修改之后通过。Concord 保存这两次执行的收据，收据成立时才允许把 Problem 标为 fixed。审阅者不必相信“已修复”这句话，可以直接查看两份收据。

## 起始状态

- 仓库已运行 `concord init`，`concord.config.ts` 的 runner 能执行测试文件。默认 runner 是 `node --test`。
- 已有一个能复现缺陷的测试，或者准备写一个。
- 下文的例子：购物车 `addItem` 第二次加入同一 SKU 时覆盖了数量，应该累加。

## 完整路径

1. 把缺陷记录为 Problem。 {#record-problem}

   ```sh
   printf '同一 SKU 第二次加入时数量被覆盖，应该累加。\n' \
     | concord --json memory add duplicate-sku --kind problem --title "重复加入覆盖数量" --body -
   ```

   ```json
   {"operation":"create-memory","dryRun":false,"changedPaths":["memory/duplicate-sku.md"]}
   ```

   `concord --json memory show duplicate-sku` 显示 `"state":"open"`、`"epoch":0` 和 `"evidenceRequirement":"command"`。

2. 让复现测试指向 Use Case 和 Problem。 {#mark-regression}

   ```sh
   concord test annotate --contract docs/feature/cart/use-case/add-item.md --regression memory/duplicate-sku.md
   ```

   ```text
   // @use-case docs/feature/cart/use-case/add-item.md
   // @regression memory/duplicate-sku.md
   ```

   把这两行放在测试声明上方并提交。`concord --json test list` 的 `cases[].id` 给出要运行的 case ID，例如 `neref_854212737ecad7effc4666629752cb98`，同一条目的 `regressions` 包含 `memory/duplicate-sku.md`。

3. 修改产品代码之前运行测试，取得 red 收据。 {#run-red}

   ```sh
   concord test run neref_854212737ecad7effc4666629752cb98
   ```

   ```text
   Command fail — neref_854212737ecad7effc4666629752cb98
   Receipt: ccev_c5131e3e563df91019790cf68acabbae
   Scope: command (does not prove native case coverage)
   Execution: nonzero; exit: 1; cleanup: true
   Timeout: false; cancelled: false; signal: null
   Arguments: ["node","--test","--test-reporter=tap","test/cart.test.js"]
   Started: 2026-10-23T02:35:11.803Z; finished: 2026-10-23T02:35:12.023Z
   Use --json to inspect all recorded digests.
   ```

   测试失败时命令退出 1，收据照常保存。`Execution: nonzero` 表示实际执行的测试数大于 0，与退出码无关。`--json` 输出完整收据，关键字段如下，省略的字段是各输入的摘要：

   ```json
   {
     "id": "ccev_c5131e3e563df91019790cf68acabbae",
     "format": "concord.command-evidence/v1",
     "scope": "command",
     "selectedCaseId": "neref_854212737ecad7effc4666629752cb98",
     "problemEpochs": {"memory/duplicate-sku.md": 0},
     "commandOutcome": "fail",
     "execution": "nonzero",
     "exitCode": 1,
     "timedOut": false,
     "cleanupOk": true
   }
   ```

4. 修改产品代码，不改测试和契约，再运行同一个 case，取得 green 收据。 {#run-green}

   ```sh
   concord --json test run neref_854212737ecad7effc4666629752cb98
   ```

   命令退出 0，收据 `id` 为 `ccev_49ed61a97f02f8811dd528980849ceb8`，`commandOutcome` 为 `pass`，`exitCode` 为 0，`cleanupOk` 为 true。

5. 用两份收据关闭 Problem。 {#resolve-fixed}

   ```sh
   concord memory resolve duplicate-sku --kind fixed \
     --red ccev_c5131e3e563df91019790cf68acabbae \
     --green ccev_49ed61a97f02f8811dd528980849ceb8 \
     --reason "addItem 累加已有数量"
   ```

   ```text
   Applied resolve-memory:
     memory/duplicate-sku.md

   Next: concord check.
   ```

## 结果

`concord --json memory show duplicate-sku` 的 `metadata` 变为：

```json
{
  "state": "resolved",
  "resolution": {
    "kind": "fixed",
    "evidenceLevel": "command",
    "epoch": 0,
    "red": "ccev_c5131e3e563df91019790cf68acabbae",
    "green": "ccev_49ed61a97f02f8811dd528980849ceb8",
    "selectedCaseId": "neref_854212737ecad7effc4666629752cb98",
    "reason": "addItem 累加已有数量",
    "at": "2026-10-23T02:36:43.897Z"
  }
}
```

之后的 `concord --json check` 在 `memoryEvidence` 中列出这两份收据，并附 `"note":"Historical command evidence; not current verification."`。这句说明表示收据记录的是当时的执行，不代表当前工作区重新验证过。

`memory resolve` 拒绝时退出 1，不修改 Problem。错误码与触发条件：

| 错误 | 触发条件 |
| --- | --- |
| `InvalidRedEvidence` | red 收据不是普通失败：超时、被信号终止、清理未确认、零执行或全部跳过，或者传入了通过的收据 |
| `InvalidGreenEvidence` | green 收据不是普通成功，或者同样属于超时、清理未确认、零执行、全部跳过 |
| `EvidenceOrder` | red 收据的执行晚于 green 收据 |
| `EvidenceStale` | 两次执行之间测试定义、runner 配置、契约或 Problem epoch 改变了，或者 green 不对应当前实现 |
| `EvidenceMismatch` | 两份收据不属于同一个 case 或同一个 worktree，签发收据的 Concord 版本与当前版本不同，或者当前测试标记不再用 `@regression` 指向这个 Problem |
| `ProblemNotOpen` | Problem 不存在或不是 open 状态 |

拒绝时的人读输出：

```text
ok: false
error: InvalidRedEvidence
message: Red evidence must be a normal nonzero command result with confirmed cleanup
```

问题再次出现时运行 `concord memory reopen duplicate-sku --reason "..."`，`--reason` 必填。Problem 回到 open，epoch 加 1，旧收据不能关闭新一轮。

## 边界

- 收据标为 `scope: command`，只证明这条命令那次的退出结果。它不证明原生 runner 的逐用例覆盖，也不证明正式 E2E 可靠性。
- 不修复缺陷的处理（`not-a-bug`、`wont-fix`、`external-fixed`）用 `--kind` 选择，只需要 `--reason`，记录为 `evidenceLevel: author`。

## 契约来源

- 命令参数与输出总览：[CLI](../cli.md#测试与证据)
- 收据、摘要与 stale 判定的实现：[架构](../architecture.md#执行管线)
