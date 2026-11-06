import { sourceCli, sourceRoot, prepareSourceConsumer, assert, execFileSync, spawnSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, tmpdir, join, resolve, test, Effect, Schema, makeOwnedProcessService, LocalRepository, initialize, setConfig, showConfig, type Call, type Receipt, connection, issue, scratch, bin, scenarioFile, callsFile, packedCli, consumer, mode, calls, writes, cli, plan, execute, error, alterReceipt } from '../support/issue-remote-fixture.ts';


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
