# 写行为测试

## 用户目标

维护者或 agent 改了一个 Use Case，或者发现某条验收没有测试，想写一个测试守护它：行为被破坏时失败，重构后仍然通过。

## 起始状态

- 要守护的验收已经写在 Spec 中，例如[无外部服务时管理本地 Issue](../../../feature/feedback/use-case/manage-local-observations.md)的结果表：仍有其它 Issue 链接时，`issue close` 拒绝并返回 `IssueReferenced`。
- 依赖已安装，`pnpm concord --help` 可以运行。

## 完整路径

1. 找到测试要指向的验收。 {#locate}

   ```sh
   pnpm concord use-case steps docs/feature/feedback/use-case/manage-local-observations.md --fresh
   ```

   输出列出每个步骤的 `ref`、已关联的 `tests` 与 `testCount`。验收是一个步骤时指向它的 `ref`；是结果表或跨多个步骤时，指向标题 anchor 或整个 Use Case（[把测试关联到步骤](../../../feature/local-sdlc/use-case/link-tests-to-steps.md)）。本例的拒绝情形在“结果”表中，指向 `#结果`。

2. 选层。 {#choose-layer}

   按[选哪一层](../README.md#选哪一层)判断。`IssueReferenced` 的判断在领域操作中，仓库内层已经能观察到；本例要守护的是它在命令行上的映射，即具名错误与退出码 1，所以写在 CLI 层，目录是 `test/cli/`。

3. 生成标记。 {#marker}

   ```sh
   pnpm concord test marker --contract 'docs/feature/feedback/use-case/manage-local-observations.md#结果'
   ```

   输出：

   ```text
   // @use-case docs/feature/feedback/use-case/manage-local-observations.md#结果
   ```

4. 写测试，表中每行一个子测试。 {#write}

   准备状态在进程内完成：`createConsumer` 复制模板仓库，`withRepository` 打开它，`createDocument` 与 `linkIssue` 是领域写入入口。被测命令通过 `test/support/cli.ts` 的 `runCli` 在测试进程内运行，显式传入 argv、cwd 和完整环境，等待本次调用的 stdout、stderr 与退出码。

   ```ts
   import assert from 'node:assert/strict';
   import { rmSync } from 'node:fs';
   import test from 'node:test';
   import { createConsumer } from '../support/consumer.ts';
   import { createDocument } from '../support/operations.ts';
   import { withRepository } from '../support/application-fixture.ts';
   import { runCli } from '../support/cli.ts';
   import { linkIssue } from '../../src/domain/issues/index.ts';

   async function call(root: string, args: readonly string[], status = 0): Promise<Record<string, unknown>> {
     const result = await runCli({ argv: ['--root', root, '--json', ...args], cwd: root, env: process.env, signal: AbortSignal.timeout(30_000) });
     assert.equal(result.exitCode, status, JSON.stringify({ args, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }));
     return JSON.parse(result.stdout.trim() || result.stderr) as Record<string, unknown>;
   }

   // @use-case docs/engineering/testing/use-case/write-behavior-test.md#write
   test('issue close refuses with a named error and exit 1', async t => {
     for (const [row, linked, expected] of [
       ['another Issue links it', true, 'IssueReferenced'],
       ['the Issue does not exist', false, 'DocumentNotFound'],
     ] as const) await t.test(row, async () => {
       const root = createConsumer();
       try {
         if (linked) withRepository(root, repo => {
           for (const id of ['one', 'two']) createDocument(repo, 'issue', { id, title: id });
           linkIssue(repo, 'two', 'docs/issues/one.md', false, 'related');
         });
         assert.equal((await call(root, ['issue', 'close', 'one', '--reason', 'Done'], 1)).error, expected);
       } finally { rmSync(root, { recursive: true, force: true }); }
     });
   });
   ```

   这段代码就是仓库中的 `test/cli/issue-close-links.test.ts`。它的标记指向本教程；`issue close` 的业务行为由 Feedback 已有的测试关联。自己写测试时，标记指向要验证的 Use Case 步骤。

   `call` 在退出码不符时把 args、exitCode、stdout 与 stderr 一起写进失败消息，满足[断言](../README.md#断言)对调用诊断的要求。

5. 让它失败一次。 {#fail-first}

   在本地临时回退被测行为，例如让 `closeIssue` 跳过引用检查，运行测试，确认 `another Issue links it` 失败且消息指出期望的 `IssueReferenced`。恢复实现后，把这次失败写进交付说明（[质量标准](../README.md#质量标准)）。

6. 运行受改动影响的测试。 {#run}

   ```sh
   pnpm gate --changed
   ```

   预期输出（节选）：

   ```text
   # Subtest: issue close refuses with a named error and exit 1
       ok 1 - another Issue links it
       ok 2 - the Issue does not exist
   ok 1 - issue close refuses with a named error and exit 1
   # Node layer cli: files=1; cases=3; countedFiles=1; 2.932s (sum of file durations)
   ```

   `--changed` 的选择规则见[完整门禁](../cli.md#完整门禁)；交付说明写明运行的是 `--changed`。

## 结果

测试文件中的标记建立了测试与 `#结果` 的关联，`concord trace show` 与 `use-case steps` 从标记推导它，不另外登记。

| 情形 | 处理 |
| --- | --- |
| 要守护的行为还不在 Spec 中 | 先写进 Use Case 或 cli 页，再写测试；测试不指向 Roadmap 或 Design |
| 不启动服务的 CLI 子测试超过 200ms，或在 CLI 层逐一枚举领域情形 | 准备步骤改用 `createDocument` 等进程内入口；领域情形下沉到 `test/domain/`，CLI 层只留映射 |
| 测试按消息文本断言错误 | 改为断言 `error` 代码 |
| 断言 `ok: false` 或“结果不为空” | 断言具体的错误码、文件内容或完整集合 |
| 测试里手写 frontmatter、配置或 JSON | 改用格式 owner 生成，见[扩展 Fixture](extend-fixtures.md#owner) |
| 一个测试断言多条无关的验收 | 拆成多个测试，各自指向一条验收 |
| `use-case steps` 没有列出新测试 | 检查标记目标路径与锚点是否存在；`concord check` 报告无效的标记 |
