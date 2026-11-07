# 扩展 Fixture

## 用户目标

维护者发现几个测试重复同一段准备：建仓库、写配置、建几篇文档、等服务就绪、最后清理。想把它收进 `test/support/` 的一个 Fixture，让每个测试只写自己的输入与断言，且不破坏共享资源与同步的规则。

## 起始状态

- 已有至少两个测试需要同一初始状态，例如“Issue `two` 链接 Issue `one`”。
- 已读[共享资源与同步](../README.md#共享资源与同步)与 [Fixture](../architecture.md#fixture)。

## 完整路径

1. 先找现成的 Fixture。 {#reuse}

   ```sh
   grep -n "^export" test/support/*.ts
   ```

   常用的入口：

   | 需要 | 使用 | 文件 |
   | --- | --- | --- |
   | 一个已初始化的临时仓库 | `createConsumer()` 返回复制自模板的仓库根；`withConsumer((repo, root) => …)` 结束时关闭并删除 | `test/support/consumer.ts` |
   | 打开已有仓库，用完关闭 | `withRepository(root, repo => …)` | `test/support/application-fixture.ts` |
   | 经领域写入入口创建文档 | `createDocument(repo, kind, input)`、`addPage`、`templateBody` | `test/support/operations.ts` |
   | 生成带 frontmatter 的文档文本 | `renderOwnerFixture(fields, body)` | `test/support/owner-fixture.ts` |
   | 写项目配置 | `writeProjectConfig(root, input)`、`readProjectConfig(root)` | `test/support/support.ts` |
   | 以 CLI 同一应用层执行查询或动作 | `query(root, request, schema)`、`action(root, input, schema)` | `test/support/application-fixture.ts` |
   | 等待真实状态 | `pollUntil(attempt, { description })`、`waitForWorkspaceProjection(base)` | `test/support/support.ts` |
   | 每次新连接的 HTTP 请求 | `fetchFresh(url, init)` | `test/support/support.ts` |
   | 在测试进程内运行一条 CLI 命令（CLI 层） | `runCli({ argv, cwd, env })` 返回 `{ stdout, stderr, exitCode }` | `test/support/cli.ts` |
   | 真实源码 CLI 入口（进程层的“运行环境”测试） | `sourceCli()` | `test/support/source-consumer.ts` |

   已有入口能表达时直接组合，不为它再包一层同名函数（[用现成的能力，不重写](../../../taste.md#t-10)）。

2. 受管内容交给格式 owner 生成。 {#owner}

   ```ts
   writeProjectConfig(root, { testRoots: ['test'] });
   const policy = parseWritingPolicy(readFileSync(join(root, 'docs/writing.md'), 'utf8'));
   writeFileSync(join(root, 'docs/writing.md'), renderWritingPolicy({ ...policy, bannedTerms: [{ term: 'buffer', use: 'document', why: 'Precise noun' }] }));
   ```

   `writeProjectConfig` 先按 `ProjectSchema` 严格解码再渲染；写作规则用 `src/model/index.ts` 的 `parseWritingPolicy` 与 `renderWritingPolicy`。格式改变时只改格式 owner，Fixture 与测试不随之修改。

3. 写出 Fixture 并写清资源回收。 {#create}

   只有一个测试文件使用的 Fixture 写在该测试文件中；多个测试文件共用时，放到 `test/support/<主题>-fixture.ts` 并导出。命名与导出遵守 [TypeScript 代码规范](../../code/README.md)。

   持有临时目录、进程或服务的 Fixture 用 `Effect.acquireRelease` 声明释放，测试用 `Effect.scoped` 限定范围。这样成功、失败与超时都会释放：

   ```ts
   /** A consumer where Issue `two` links `one`; closing the scope deletes it. */
   const linkedIssues = Effect.acquireRelease(
     Effect.sync(() => {
       const root = createConsumer();
       withRepository(root, repo => {
         for (const id of ['one', 'two']) createDocument(repo, 'issue', { id, title: id });
         linkIssue(repo, 'two', 'docs/issues/one.md', false, 'related');
       });
       return root;
     }),
     root => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
   );
   ```

   测试这样使用。Scope 结束后断言临时仓库已删除，观察到资源确实释放：

   ```ts
   // @use-case docs/engineering/testing/use-case/extend-fixtures.md#create
   test('linked Issue fixture closes repositories and removes its scoped consumer', () => Effect.runPromise(Effect.gen(function*() {
     const root = yield* Effect.scoped(Effect.gen(function*() {
       const root = yield* linkedIssues;
       withRepository(root, repo => assert.throws(() => closeIssue(repo, 'one', 'Done'), (cause: unknown) => cause instanceof ConcordError && cause.code === 'IssueReferenced'));
       assert.equal(existsSync(join(root, 'docs/issues/one.md')), true);
       return root;
     }));
     assert.equal(existsSync(root), false);
   })));
   ```

   这两段来自 `test/domain/issue-close-links.test.ts`。

   `test/support/external-adapter-fixture.ts` 的 `externalCase` 是同样写法的真实例子。标记写在测试文件中，不写在 Fixture 里。

4. 等待与请求遵守同步规则。 {#wait}

   等服务或投影时用 `pollUntil` 轮询真实状态，并给出 `description`，超时消息会写明在等什么；HTTP 请求用 `fetchFresh`，每次新连接。不在 Fixture 里加固定的 sleep 或整段重试。

5. 会改坏安装文件的 Fixture 使用私有副本。 {#private}

   在 `mkdtempSync(join(tmpdir(), 'concord-<主题>-'))` 得到的目录中复制要修改的文件，替换可能被映射的文件时先写同目录新文件再 rename。`tmpdir` 取自 `test/support/temporary.ts`。

6. 运行门禁。 {#run}

   ```sh
   pnpm gate --changed
   ```

   改动了 `test/support/` 时，`--changed` 选中全部测试（[完整门禁](../cli.md#完整门禁)）。这是一次完整门禁，与同一台机器上的其它门禁共用准入池。

   被修复核验冻结的支持文件列在 `concord.config.ts` 的 `runner.sourceFiles`，见 [Runner 适配](../architecture.md#runner-适配)。

## 结果

重复的准备收进一个有名字的 Fixture，资源随 Scope 释放，受管内容仍由格式 owner 生成。

| 情形 | 处理 |
| --- | --- |
| Fixture 里手写 frontmatter、配置或 JSON | 改用 `createDocument`、`renderOwnerFixture`、`writeProjectConfig` 或对应格式的渲染函数 |
| Fixture 为 Concord 自己的模块写 fake 或 mock | 删除；只为远端服务、模型等外部边界写 fake（[分层](../README.md#分层)） |
| 每个测试都重新 `git init` 与 `concord init` | 改用 `createConsumer`，复制模板仓库 |
| 测试失败后留下临时目录或进程 | 资源改用 `Effect.acquireRelease`，或在 `finally` 中回收 |
| 门禁报 `PollTimeout` | 读消息中的 `description`，找出没有到达的状态；不以加大 `timeoutMs` 消除失败 |
| 同一 Fixture 被多个测试文件并发使用时互相干扰 | 每次调用返回自己的临时目录与端口，不共享可变的全局状态 |
