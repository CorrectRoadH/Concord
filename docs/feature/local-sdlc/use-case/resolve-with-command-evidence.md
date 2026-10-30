# 核验修复并关闭缺陷

## 用户目标

修复缺陷的工程师要证明修复确实生效：回归测试在修复之前的提交上失败，在修复之后的提交上通过。Concord 在关闭 Issue 之前执行这次核验，把缺陷提交、修复提交与测试写进 Issue。审阅者不必相信“已修复”这句话，可以在任何具备依赖的 clone 中重放核验（[决策依据](../../../design/sdd-core-model/DECISION.md)）。

## 起始状态

- 仓库已运行 `concord init`，`concord.config.ts` 的 `runner` 能执行测试文件。修复核验需要配置 runner。
- 下文的例子：购物车 `addItem` 第二次加入同一 SKU 时覆盖了数量，应该累加。

## 完整路径

本页示例为预期输出。

1. 把缺陷记录为 Issue。 {#record-issue}

   ```sh
   concord --json new issue duplicate-sku
   ```

   ```json
   {"operation":"new","dryRun":false,"changedPaths":["docs/issues/duplicate-sku.md"]}
   ```

   也可以直接创建 `docs/issues/duplicate-sku.md`，frontmatter 写 `status: open`，正文写一级标题与缺陷描述。

2. 提交会失败的回归测试。 {#commit-regression}

   ```js
   // @use-case docs/feature/cart/use-case/add-item.md
   // @issue docs/issues/duplicate-sku.md
   test('adding the same sku twice sums the quantity', () => { ... });
   ```

   `@issue` 指向这条测试守护的 Issue，可以重复。只提交测试，不改产品代码。

3. 修改产品代码并单独提交。 {#commit-fix}

   修复提交不改回归测试、runner 配置、`runner.sourceFiles` 与测试指向的 Spec。

4. 在干净的工作树中关闭 Issue。 {#close-fixed}

   ```sh
   concord issue close duplicate-sku --fixed --reason "addItem 累加已有数量"
   ```

   ```text
   Verified fix — docs/issues/duplicate-sku.md
   Defect: 3f2a91c (runner exit 1)
   Fix: HEAD 8c04d7e (runner exit 0)
   Tests: neref_854212737ecad7effc4666629752cb98
   Applied close-issue:
     docs/issues/duplicate-sku.md
   ```

   修复提交是当前 HEAD。缺陷提交默认是 HEAD 的 first-parent 历史中最早出现这些回归测试的提交；所有回归测试必须在同一提交中首次出现，否则用 `--defect <commit>` 指定，该提交必须是 HEAD 的 first-parent 祖先。runner 在缺陷提交上以非零码结束、在修复提交上以零结束时，核验成立。

5. 重放核验。 {#verify}

   ```sh
   concord --json test verify duplicate-sku
   ```

   命令按 Issue 中记录的提交与测试重新运行，不改变已记录的结论。提交、依赖或运行环境不可获得时报告无法重放。

## 结果

`docs/issues/duplicate-sku.md` 的 frontmatter 变为：

```yaml
status: closed
closure:
  kind: fixed
  reason: addItem 累加已有数量
  verification:
    defect: 3f2a91c...
    fix: 8c04d7e...
    tests:
      - neref_854212737ecad7effc4666629752cb98
    runner: sha256:...
    concord: 0.4.0
```

`verification` 记录缺陷与修复提交、按测试关联 ID 列出的回归测试、runner 配置摘要与执行核验的 Concord 版本。

不经 `issue close` 直接写入或修改的 `verification`，由 `check --since <base>` 按记录重放核验，见[检查本次变化](../cli.md#检查本次变化)。`check` 在以下情况报告 finding：fixed 没有 `verification`、记录的提交不存在、记录的测试不再用 `@issue` 指向该 Issue。

`issue close --fixed` 拒绝时退出 1，不修改 Issue：

| 错误 | 触发条件 |
| --- | --- |
| `FixUnverifiable` | 工作树不干净；缺少回归测试；回归测试不在同一提交中首次出现且未给出 `--defect`；`--defect` 不是 HEAD 的 first-parent 祖先；缺陷提交不存在，包括 shallow clone |
| `FixUnverifiable` | 缺陷提交与 HEAD 之间含 merge 提交，或回归测试、runner 配置、`runner.sourceFiles`、测试指向的 Spec 字节有变化 |
| `FixUnverifiable` | runner 在缺陷提交上以零结束，例如同一提交同时加入测试与修复；任一次运行超时或清理无法确认 |
| `FixVerificationFailed` | runner 在修复提交上以非零码结束 |
| `PreimageChanged` | 核验期间 HEAD、工作树、配置或 Issue 被改动 |

同一提交加入测试与修复时无法核验，错误提示先单独提交失败的回归测试。

```text
ok: false
error: FixUnverifiable
message: Regression tests and the fix were added in the same commit; commit the failing regression test first, then the fix
```

问题再次出现时运行 `concord issue reopen duplicate-sku`。`closure` 被删除，`status` 回到 open；再次关闭需要新的核验。

## 边界

- 只支持线性路径：先提交回归测试，再提交修复。
- command runner 不区分断言失败与构建失败，缺陷提交上的非零退出码也可能来自构建失败。
- 核验只证明 runner 在两个提交上的退出结果，不证明原生 runner 的逐用例覆盖，也不证明正式 E2E 可靠性。
- 不修复缺陷的关闭种类见[本地观察](../../feedback/use-case/manage-local-observations.md)。

## Spec 来源

- 命令参数与输出总览：[CLI](../cli.md#测试与修复核验)
- 核验的执行与清理：[架构](../architecture.md#修复核验)
