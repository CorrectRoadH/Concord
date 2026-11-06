import { sourceCli, sourceRoot, prepareSourceConsumer, assert, execFileSync, spawnSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, tmpdir, join, resolve, test, Effect, Schema, makeOwnedProcessService, LocalRepository, initialize, setConfig, showConfig, type Call, type Receipt, connection, issue, scratch, bin, scenarioFile, callsFile, packedCli, consumer, mode, calls, writes, cli, plan, execute, error, alterReceipt } from '../support/issue-remote-fixture.ts';


// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('owned process transports stdin and preserves default ignored stdin', async () => {
  const processService = makeOwnedProcessService();
  const input = '@a local path\n你好';
  const result = await Effect.runPromise(Effect.scoped(processService.run([process.execPath, '-e', "let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',v=>s+=v);process.stdin.on('end',()=>process.stdout.write(s))"], { cwd: tmpdir(), stdin: input })));
  assert.equal(result.stdout, input);
  assert.equal(result.exitCode, 0);
  assert.equal(result.groupCleanup.gone, process.platform === 'win32' ? null : true);
  const ignored = await Effect.runPromise(Effect.scoped(processService.run([process.execPath, '-e', "process.stdin.on('end',()=>process.stdout.write('EOF'));process.stdin.resume()"], { cwd: tmpdir() })));
  assert.equal(ignored.stdout, 'EOF');
});



// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed writes fix PATCH fields, encode labels, retain literal @ bodies and preview no change', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('operations'); const body = join(root, 'body.txt'); writeFileSync(body, '@secret-path\n你好');
  for (const [operation, args, expected] of [
    ['body-set', ['12', '--body', body], { body: '@secret-path\n你好' }],
    ['comment-add', ['12', '--body', body], { body: '@secret-path\n你好' }],
    ['labels-add', ['12', '--label', '@x', '--label', 'slash/a b'], { labels: ['@x', 'slash/a b'] }],
    ['labels-remove', ['12', '--label', 'slash/a b'], {}],
    ['reopen', ['12'], { state: 'open' }],
  ] as const) {
    mode({ issue: issue(12, operation === 'reopen' ? { state: 'closed' } : operation === 'labels-remove' ? { labels: [{ name: 'slash/a b' }] } : {}) });
    const receipt = plan(root, operation, args); assert.equal(execute(root, receipt).status, 0);
    assert.equal(writes().length, 1); assert.deepEqual(JSON.parse(writes()[0]!.stdin), expected);
    if (operation === 'labels-remove') assert.equal(writes()[0]!.args.at(-1), 'repos/example/product/issues/12/labels/slash%2Fa%20b');
    if (operation !== 'comment-add') error(cli(root, ['preview', operation, ...args, '--connection', connection.id]), 'IssueNoChange');
  }
})));
