# 核验修复并关闭缺陷

## 用户目标

修复缺陷的工程师要证明修复确实生效：回归测试在修复之前的提交上失败，在修复之后的提交上通过。Concord 在关闭 Issue 之前执行这次核验，通过后删除 Issue，并输出一段写进提交说明的结论。审阅者不必相信“已修复”这句话，可以按这段结论在任何具备依赖的 clone 中重放核验。

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

   也可以直接创建 `docs/issues/duplicate-sku.md`，正文写一级标题与缺陷描述。

2. 提交会失败的回归测试。 {#commit-regression}

   ```js
   // @use-case docs/feature/cart/use-case/add-item.md
   // @issue docs/issues/duplicate-sku.md
   test('adding the same sku twice sums the quantity', () => { ... });
   ```

   `@issue` 指向这条测试守护的 Issue，可以重复。只提交测试，不改产品代码。

3. 修改产品代码并单独提交。 {#commit-fix}

   修复提交不改回归测试、runner 配置、`runner.sourceFiles` 与测试指向的 Spec。

4. 关闭 Issue。 {#close-fixed}

   ```sh
   concord issue close duplicate-sku --fixed --reason "addItem 累加已有数量"
   ```

   ```text
   Verified fix — docs/issues/duplicate-sku.md
   Defect: 3f2a91c (runner exit 1)
   Fix: HEAD 8c04d7e (runner exit 0)
   Tests: neref_854212737ecad7effc4666629752cb98
   Runner: sha256:4b1e...
   Closed docs/issues/duplicate-sku.md

   Put the lines above in your commit message.
   ```

   核验通过后，命令在同一次写入中删除 Issue 文件，并删掉回归测试里的 `@issue` 行（测试与它的 `@use-case` 标记保留），输出的结论写进提交说明。之后重放只按测试 ID 与两个提交进行，不依赖 `@issue`。

   修复提交默认是核验开始时的 HEAD；`--fix <commit>` 指定更早的修复提交，它必须是 HEAD 的 first-parent 祖先、并在缺陷提交之后。其他人在修复之后改动共享的测试设施时，用它指向实际的修复提交。缺陷提交默认是 HEAD 的 first-parent 历史中最早出现这些回归测试的提交；所有回归测试必须在同一提交中首次出现，否则用 `--defect <commit>` 指定，该提交必须是 HEAD 的 first-parent 祖先。runner 在缺陷提交上以非零码结束、在修复提交上以零结束时，核验成立。

   两次运行都在各自提交的临时 worktree 中执行，先运行 `runner.prepare` 准备依赖与构建，与当前 worktree 隔离：其它人尚未提交的改动不影响核验，核验期间其它人提交新的 HEAD 也不使已开始的核验失效，结论记录开始时的修复提交。只有该 Issue 文件必须没有未提交的改动。

5. 重放核验。 {#verify}

   ```sh
   concord --json test verify --defect 3f2a91c --fix 8c04d7e neref_854212737ecad7effc4666629752cb98
   ```

   命令按提交说明里的提交与测试重新运行，只报告结果，不写文件。提交、依赖或运行环境不可获得时报告无法重放。

## 结果

`docs/issues/duplicate-sku.md` 被删除。缺陷提交、修复提交、按测试关联 ID 列出的回归测试与 runner 配置摘要写在提交说明里，以后从 Git 历史查。

`issue close --fixed` 拒绝时退出 1，不修改 Issue：

| 错误 | 触发条件 |
| --- | --- |
| `FixUnverifiable` | Issue 文件有未提交的改动；缺少回归测试；回归测试不在同一提交中首次出现且未给出 `--defect`；`--defect` 不是 HEAD 的 first-parent 祖先，或 `--fix` 不是 HEAD 的 first-parent 祖先、不在缺陷提交之后；缺陷提交不存在，包括 shallow clone |
| `FixUnverifiable` | 缺陷提交与修复提交之间含 merge 提交，或回归测试、runner 配置、`runner.sourceFiles`、测试指向的 Spec 字节有变化 |
| `FixUnverifiable` | runner 在缺陷提交上以零结束，例如同一提交同时加入测试与修复；任一次运行超时或清理无法确认 |
| `FixVerificationFailed` | runner 在修复提交上以非零码结束 |
| `FileChangedSinceRead` | 核验期间 Issue 文件被改动 |
| `IssueReferenced` | 仍有页面或其它 Issue 链接这个 Issue |

同一提交加入测试与修复时无法核验，错误提示先单独提交失败的回归测试。

```text
ok: false
error: FixUnverifiable
message: Regression tests and the fix were added in the same commit; commit the failing regression test first, then the fix
```

问题再次出现时，新建一个 Issue。

## 边界

- 只支持线性路径：先提交回归测试，再提交修复。
- command runner 不区分断言失败与构建失败，缺陷提交上的非零退出码也可能来自构建失败。
- 核验只证明 runner 在两个提交上的退出结果，不证明原生 runner 的逐用例覆盖，也不证明正式 E2E 可靠性。
- 不修复缺陷就关闭 Issue，见[本地 Issue](../../feedback/use-case/manage-local-observations.md#close)。

## Spec 来源

- 命令参数与输出总览：[CLI](../cli.md#测试与修复核验)
- 核验的执行与清理：[架构](../architecture.md#修复核验)
