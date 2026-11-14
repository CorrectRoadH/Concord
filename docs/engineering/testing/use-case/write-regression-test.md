# 写回归测试

## 用户目标

维护者发现 Concord 的实现违反了 Spec，想先用一个会失败的测试固定这个缺陷，再修复它，由 agent 使用项目测试命令确认修复，再关闭 Issue。

## 起始状态

- 被违反的条目已在 Spec 中，例如 `issue close` 在仍有其它 Issue 链接时应拒绝，见[无外部服务时管理本地 Issue](../../../feature/feedback/use-case/manage-local-observations.md#结果)。Spec 本身不对时先改 Spec，不走这条路径。
- 本仓库使用 `bun run test <file>` 直接调用官方 Bun test。

## 完整路径

1. 记下缺陷。 {#record}

   ```sh
   bun run concord new issue close-ignores-links
   ```

   在 `docs/issues/close-ignores-links.md` 中写现象、期望与复现命令。调查与根因写进 Memory，用 `relations` 关联（`concord --skill feedback`）。

2. 生成带 `@issue` 的标记。 {#marker}

   ```sh
   bun run concord test marker --contract 'docs/feature/feedback/use-case/manage-local-observations.md#结果' --issue docs/issues/close-ignores-links.md
   ```

   输出：

   ```text
   // @use-case docs/feature/feedback/use-case/manage-local-observations.md#结果
   // @issue docs/issues/close-ignores-links.md
   ```

   Issue 文件不存在时命令返回 `ReferenceNotFound`，先完成上一步。

3. 在能观察到缺陷的最低一层写测试。 {#write}

   本例的判断在领域操作 `closeIssue` 中，写在 `test/domain/`。写法与[上手示例](../README.md#上手示例)相同，只是标记块多一行 `@issue`：

   ```ts
   // @use-case docs/engineering/testing/use-case/write-regression-test.md#write
   test('close refuses while another Issue links the target', () => Effect.runPromise(Effect.sync(() => withConsumer(repo => {
     for (const id of ['one', 'two']) createDocument(repo, 'issue', { id, title: id });
     linkIssue(repo, 'two', 'docs/issues/one.md', false, 'related');
     assert.throws(() => closeIssue(repo, 'one', 'Done'), (cause: unknown) => cause instanceof ConcordError && cause.code === 'IssueReferenced');
   }))));
   ```

   这段代码是仓库中 `test/domain/issue-close-links.test.ts` 的第一条测试。它在当前代码上通过，只演示写法，所以标记指向本教程且没有 `@issue`。

   真实的回归测试在标记块加上第 2 步的 `@issue` 一行，指向真实存在的 Issue；本页的 `close-ignores-links` 只是示意。

   `withConsumer` 来自 `test/support/consumer.ts`，`createDocument` 来自 `test/support/operations.ts`，`closeIssue` 与 `linkIssue` 来自 `src/domain/issues/index.ts`，`ConcordError` 来自 `src/model/index.ts`。

4. 使用项目测试命令确认复现。 {#reproduce}

   ```sh
   bun run test test/domain/issue-close-links.test.ts
   ```

   真实缺陷应导致相应断言失败。确认失败来自要修复的行为；环境故障、超时或共享资源争用不当作复现。测试已经通过时，重新检查断言与复现条件。

5. 修复并运行相关验证。 {#validate}

   使用同一定向测试文件确认修复；按项目交付规则执行必要静态检查。agent 报告实际命令、结果和未验证项，管理本轮启动的进程与临时资源。测试基础设施本身有缺陷时可以修正测试，解释前后证据，不要求特定提交划分。

6. 关闭已处理的 Issue。 {#close}

   ```sh
   bun run concord issue close close-ignores-links --reason "close 检查入链；相关回归测试通过"
   ```

   关闭原子删除 Issue 与对应 `@issue` 行，不再运行测试或读取提交历史。将处理结论和真实验证结果写入交付或提交说明，流程见[用项目自己的工具验证改动](../../../feature/local-sdlc/use-case/validate-change-with-project-tools.md)。



## 结果

回归测试留在仓库中继续守护这条验收，`@issue` 行在关闭时被删除。agent 的测试结果只说明实际验证过的范围，不证明其它情形已经覆盖（[只声称证明过的](../../../taste.md#t-5)）。

| 情形 | 处理 |
| --- | --- |
| 测试在修复前已经通过 | 测试没有复现缺陷；检查断言或换一个能观察缺陷的入口 |
| 测试与修复在同一提交 | 正常交付；是否拆分由项目和 agent 按实际需要决定 |
| 缺陷在测试自身或测试设施 | 修正相应代码，说明原始失败与修复后的定向验证 |
| 超时或连接重置 | 先在空闲机器上确认，再归因（[共享资源与同步](../README.md#共享资源与同步)） |
| 没有适用自动测试 | 按项目要求验证并报告局限，不伪造通过证据 |
