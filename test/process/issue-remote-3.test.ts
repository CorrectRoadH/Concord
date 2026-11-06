import { packageBin, sourceConcord, prepareSourceConsumer, assert, execFileSync, spawnSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, tmpdir, join, resolve, test, Effect, Schema, makeOwnedProcessService, LocalRepository, initialize, setConfig, showConfig, type Call, type Receipt, connection, issue, scratch, bin, scenarioFile, callsFile, packedCli, consumer, mode, calls, writes, cli, plan, execute, error, alterReceipt } from '../support/issue-remote-fixture.ts';


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


// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed create scans both states, narrows preimage and checks machine origin conflicts', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('create'); const body = join(root, 'body.txt'); writeFileSync(body, 'manual body'); mode({ list: [issue(2, { title: 'other' })] });
  const receipt = plan(root, 'create', ['--title', 'Planned title', '--body', body]);
  writeFileSync(scenarioFile, JSON.stringify({ issue: issue(), list: [issue(2, { title: 'changed unrelated' })] }));
  assert.equal(execute(root, receipt).status, 0); assert.equal(writes().length, 1);
  mode(); const sameTitle = plan(root, 'create', ['--title', 'Planned title', '--body', body]); writeFileSync(scenarioFile, JSON.stringify({ issue: issue(), list: [issue(5)] })); error(execute(root, sameTitle), 'IssuePlanDrifted'); assert.equal(writes().length, 0);
  const machineBody = `origin-key: machine.1\npayload-sha256: ${'a'.repeat(64)}\n`; writeFileSync(body, machineBody); mode({ list: [issue(3, { body: machineBody, state: 'closed' })] });
  error(cli(root, ['preview', 'create', '--title', 'x', '--body', body, '--origin-key', 'machine.1', '--connection', connection.id]), 'IssueCreateConflict'); assert.equal(writes().length, 0);
  mode({ list: [issue(3, { body: 'unrelated', state: 'closed' })] }); const machine = plan(root, 'create', ['--title', 'x', '--body', body, '--origin-key', 'machine.1']);
  writeFileSync(scenarioFile, JSON.stringify({ issue: issue(), list: [issue(3, { body: 'changed unrelated', state: 'closed' })] })); assert.equal(execute(root, machine).status, 0);
  error(cli(root, ['preview', 'create', '--title', 'x', '--body', body, '--origin-key', 'machine.1', '--connection', connection.id]), 'IssueCreateConflict');
})));


// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed rejected and uncertain writes remain consumed and are never retried', () => Effect.runPromise(Effect.sync(() => {
  for (const kind of ['reject', 'invalidWrite', 'signalWrite']) {
    const root = consumer(`write-${kind}`); mode({ [kind]: kind === 'reject' ? 403 : true }); const receipt = plan(root, 'close'); const result = execute(root, receipt);
    error(result, kind === 'reject' ? 'IssueRemoteRejected' : 'IssueMutationUncertain'); assert.equal(writes().length, 1);
    const details = (JSON.parse(result.stderr) as { details: Readonly<Record<string, unknown>> }).details;
    if (kind === 'reject') { assert.equal(details.status, 403); const outcome = JSON.parse(readFileSync(join(root, '.git/concord/issue-plan/v1/consumed', `${receipt.receiptId}.outcome.json`), 'utf8')) as { state: string; status: number }; assert.equal(outcome.state, 'rejected'); assert.equal(outcome.status, 403); }
    else { assert.equal(details.receiptId, receipt.receiptId); assert.equal(details.method, 'PATCH'); assert.equal(details.path, 'repos/example/product/issues/12'); assert.equal((JSON.parse(readFileSync(join(root, '.git/concord/issue-plan/v1/consumed', `${receipt.receiptId}.outcome.json`), 'utf8')) as { state: string }).state, 'uncertain'); }
    error(execute(root, receipt), 'IssuePlanConsumed'); assert.equal(writes().length, 1);
    if (kind !== 'reject') error(cli(root, ['preview', 'close', '12', '--connection', connection.id]), 'IssueNoChange');
  }
})));


// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed apply rejects another connection and another payload authorization before gh calls', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('binding'); mode();
  const repository = new LocalRepository(root);
  try { const config = showConfig(repository); setConfig(repository, { ...config.config, feedbackConnections: [connection, { ...connection, id: 'alias-gh' }] }, config.digest); } finally { repository.close(); }
  const body = join(root, 'body.txt'); writeFileSync(body, 'first');
  const first = plan(root, 'body-set', ['12', '--body', body]); writeFileSync(body, 'second');
  const second = plan(root, 'body-set', ['12', '--body', body]);
  const before = calls().length;
  error(execute(root, first, second.authorize), 'IssueAuthorizationMismatch');
  error(execute(root, first, first.authorize, 'alias-gh'), 'IssueAuthorizationMismatch');
  assert.equal(calls().length, before); assert.equal(writes().length, 0);
})));
