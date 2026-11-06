# 写回归测试

## 用户目标

维护者发现 Concord 的实现违反了 Spec，想先用一个会失败的测试固定这个缺陷，再修复它，最后用修复核验证明修复生效并关闭 Issue。

## 起始状态

- 被违反的条目已在 Spec 中，例如 `issue close` 在仍有其它 Issue 链接时应拒绝，见[无外部服务时管理本地 Issue](../../../feature/feedback/use-case/manage-local-observations.md#结果)。Spec 本身不对时先改 Spec，不走这条路径。
- 本仓库的 `concord.config.ts` 已配置 `runner`：`prepare` 安装依赖并准备原生绑定，`argv` 用 `node scripts/test-built.ts` 运行一个测试文件。

## 完整路径

1. 记下缺陷。 {#record}

   ```sh
   pnpm concord new issue close-ignores-links
   ```

   在 `docs/issues/close-ignores-links.md` 中写现象、期望与复现命令。调查与根因写进 Memory，用 `relations` 关联（`concord --skill feedback`）。

2. 生成带 `@issue` 的标记。 {#marker}

   ```sh
   pnpm concord test marker --contract 'docs/feature/feedback/use-case/manage-local-observations.md#结果' --issue docs/issues/close-ignores-links.md
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
   // @use-case docs/feature/feedback/use-case/manage-local-observations.md#结果
   // @issue docs/issues/close-ignores-links.md
   test('close refuses while another Issue links the target', () => withConsumer(repo => {
     for (const id of ['one', 'two']) createDocument(repo, 'issue', { id, title: id });
     linkIssue(repo, 'two', 'docs/issues/one.md', false, 'related');
     assert.throws(() => closeIssue(repo, 'one', 'Done'), (cause: unknown) => cause instanceof ConcordError && cause.code === 'IssueReferenced');
   }));
   ```

   `withConsumer` 来自 `test/support/consumer.ts`，`createDocument` 来自 `test/support/operations.ts`，`closeIssue` 与 `linkIssue` 来自 `src/domain/issues/index.ts`，`ConcordError` 来自 `src/model/index.ts`。

4. 确认它在当前代码上失败，单独提交。 {#commit-test}

   ```sh
   pnpm gate test/domain/issue-close-links.test.ts
   ```

   预期输出（节选）：

   ```text
   not ok 1 - close refuses while another Issue links the target
   # Node file: /home/me/Code/Concord/test/domain/issue-close-links.test.ts; 1.402s; success=false; logs=…
   ```

   ```sh
   git add -N test/domain/issue-close-links.test.ts docs/issues/close-ignores-links.md
   git commit -m "test: issue close must refuse linked Issues" -- test/domain/issue-close-links.test.ts docs/issues/close-ignores-links.md
   ```

   共享 checkout 中只提交自己的文件，用 `git commit -- <路径>`，不提交他人尚未提交的改动。

5. 修复并单独提交。 {#commit-fix}

   只改产品文件。修复提交不改回归测试、runner 配置、`runner.sourceFiles` 与测试指向的 Spec，否则核验返回 `FixUnverifiable`。提交前运行 `pnpm gate --changed` 与 `pnpm concord check`。

6. 核验并关闭 Issue。 {#close}

   ```sh
   pnpm concord issue close close-ignores-links --fixed --reason "close 检查入链"
   ```

   命令在临时 worktree 中对缺陷提交执行 `runner.prepare` 与 runner，在当前工作树对 HEAD 执行 runner；前者失败、后者通过才删除 Issue。输出与拒绝条件见[核验修复并关闭缺陷](../../../feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed)，把输出的结论写进提交说明并提交 Issue 的删除。

## 结果

回归测试留在仓库中继续守护这条验收，`@issue` 行在关闭时被删除；修复核验只证明这条测试在缺陷提交上失败、在修复后通过，不证明其它情形已覆盖（[只声称证明过的](../../../taste.md#t-5)）。

| 情形 | 处理 |
| --- | --- |
| 测试在当前代码上已经通过 | 测试没有复现缺陷；收紧断言或换一个能观察到缺陷的入口 |
| 测试与修复在同一提交中 | 核验返回 `FixUnverifiable`；拆成两个提交 |
| 修复时顺手改了回归测试或 `runner.sourceFiles` 中的文件 | 核验返回 `FixUnverifiable`；撤回这部分改动，另行提交 |
| 测试因超时或连接重置失败 | 不是缺陷复现；在空闲机器上复跑后再归因（[共享资源与同步](../README.md#共享资源与同步)） |
| 缺陷提交与 HEAD 之间有 merge 提交 | 不支持，核验返回 `FixUnverifiable`，见[核验修复并关闭缺陷](../../../feature/local-sdlc/use-case/resolve-with-command-evidence.md) |
| 回归测试不是在同一个提交中首次出现 | 用 `--defect <commit>` 指定 HEAD 的 first-parent 祖先作为缺陷提交 |
