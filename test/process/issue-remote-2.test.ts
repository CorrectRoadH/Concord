import { packageBin, packConcord, installConcord, assert, execFileSync, spawnSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, tmpdir, join, resolve, test, Effect, Schema, makeOwnedProcessService, LocalRepository, initialize, setConfig, showConfig, type Call, type Receipt, connection, issue, scratch, bin, scenarioFile, callsFile, packedCli, consumer, mode, calls, writes, cli, plan, execute, error, alterReceipt } from '../support/issue-remote-fixture.js';


// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed plan/execute binds authorization, consumes once, uses stdin and emits private outcome', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('authorization'); mode();
  const receipt = plan(root, 'close', ['12', '--reason', 'completed']);
  const before = calls().length;
  error(execute(root, receipt, 'close:example/product#12@000000000000'), 'IssueAuthorizationMismatch');
  assert.equal(calls().length, before, 'authorization mismatch must not invoke gh');
  error(execute(root, receipt, 'close:example/product#12'), 'IssueAuthorizationMismatch');
  const result = execute(root, receipt); assert.equal(result.status, 0, result.stderr);
  assert.equal(writes().length, 1); assert.deepEqual(JSON.parse(writes()[0]!.stdin), { state: 'closed', state_reason: 'completed' });
  assert.ok(writes()[0]!.args.includes('--input')); assert.ok(!writes()[0]!.args.some(arg => ['-f', '-F', '--field', '--raw-field'].includes(arg)));
  assert.ok(calls().every(call => call.env.GH_REPO === undefined && call.env.GH_DEBUG === undefined));
  const outcome = join(root, '.git/concord/issue-plan/v1/consumed', `${receipt.receiptId}.outcome.json`);
  assert.equal((JSON.parse(readFileSync(outcome, 'utf8')) as { state: string }).state, 'applied'); assert.equal(statSync(outcome).mode & 0o777, 0o600);
  error(execute(root, receipt), 'IssuePlanConsumed'); assert.equal(writes().length, 1);
  error(cli(root, ['plan', 'close', '12', '--connection', connection.id]), 'IssueNoChange');
})));


// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed execute rejects expired, drifted, corrupt and wrong repository plans without writes', () => Effect.runPromise(Effect.sync(() => {
  for (const variant of ['expired', 'drifted', 'repository', 'corrupt']) {
    const root = consumer(variant); mode(); const receipt = plan(root, 'close');
    if (variant === 'expired') alterReceipt(root, receipt, { expiresAt: 0 });
    if (variant === 'corrupt') alterReceipt(root, receipt, { unknown: true });
    if (variant === 'drifted') writeFileSync(scenarioFile, JSON.stringify({ issue: issue(12, { body: 'changed' }) }));
    if (variant === 'repository') writeFileSync(scenarioFile, JSON.stringify({ repositoryId: 999, issue: issue() }));
    error(execute(root, receipt), { expired: 'IssuePlanExpired', drifted: 'IssuePlanDrifted', repository: 'ConnectionIdentityMismatch', corrupt: 'IssuePlanCorrupt' }[variant]!);
    assert.equal(writes().length, 0);
    if (variant === 'repository') { const outcome = JSON.parse(readFileSync(join(root, '.git/concord/issue-plan/v1/consumed', `${receipt.receiptId}.outcome.json`), 'utf8')) as { state: string; code: string }; assert.equal(outcome.state, 'aborted'); assert.equal(outcome.code, 'ConnectionIdentityMismatch'); }
    if (variant === 'drifted') assert.equal((JSON.parse(readFileSync(join(root, '.git/concord/issue-plan/v1/consumed', `${receipt.receiptId}.outcome.json`), 'utf8')) as { state: string }).state, 'drifted');
  }
})));


// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed plans reject PR, unbound/API connections, no change, invalid labels and output/page budgets', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('reject-plans');
  for (const [extra, args, code] of [
    [{ issue: issue(12, { pull_request: {}, html_url: 'https://github.com/example/product/pull/12' }) }, ['close', '12'], 'IssueTargetIsPullRequest'],
    [{ issue: issue(12, { state: 'closed' }) }, ['close', '12'], 'IssueNoChange'],
    [{}, ['reopen', '12'], 'IssueNoChange'],
    [{}, ['labels-add', '12', '--label', 'old'], 'IssueNoChange'],
    [{}, ['labels-remove', '12', '--label', 'missing'], 'IssueNoChange'],
    [{}, ['labels-add', '12', '--label', 'x'.repeat(51)], 'InvalidInput'],
    [{}, ['labels-add', '12', '--label', 'bad\nlabel'], 'InvalidInput'],
    [{}, ['labels-remove', '12', '--label', 'old', '--label', 'other'], 'InvalidInput'],
    [{ oversize: true }, ['close', '12'], 'IssueRemoteBudgetExceeded'],
    [{ pages: true, issue: issue(12, { body: 'x'.repeat(16000) }) }, ['create', '--title', 'x', '--body', join(root, 'body.txt')], ['IssueRemoteBudgetExceeded', 'GhTimeout']],
    [{ pages: true }, ['create', '--title', 'x', '--body', join(root, 'body.txt')], ['IssueRemoteBudgetExceeded', 'GhTimeout']],
  ] as const) {
    writeFileSync(join(root, 'body.txt'), 'body'); mode(extra); error(cli(root, ['plan', ...args, '--connection', connection.id]), code); assert.equal(writes().length, 0);
  }
  assert.equal(existsSync(join(root, '.git/concord/issue-plan/v1/planned')), false, 'failed plan must not sign a receipt');
  const unbound = consumer('unbound', { ...connection, repositoryId: undefined }); mode(); error(cli(unbound, ['plan', 'close', '12', '--connection', connection.id]), 'IssueConnectionUnbound'); assert.equal(calls().length, 0);
  const api = consumer('api', { ...connection, transport: 'api', credentialEnv: 'TEST_TOKEN' }); mode(); error(cli(api, ['plan', 'close', '12', '--connection', connection.id]), 'IssueRemoteTransportUnsupported'); assert.equal(calls().length, 0);
})));



// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed execute aborts on read budgets and preserves rejection when outcome publication fails', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('outcome-errors'); mode(); const receipt = plan(root, 'close');
  writeFileSync(scenarioFile, JSON.stringify({ issue: issue(), oversize: true }));
  error(execute(root, receipt), 'IssueRemoteBudgetExceeded'); assert.equal(writes().length, 0);
  const outcome = JSON.parse(readFileSync(join(root, '.git/concord/issue-plan/v1/consumed', `${receipt.receiptId}.outcome.json`), 'utf8')) as { state: string; code: string };
  assert.deepEqual({ state: outcome.state, code: outcome.code }, { state: 'aborted', code: 'IssueRemoteBudgetExceeded' });
  mode({ reject: 500 }); const rejected = plan(root, 'close');
  mkdirSync(join(root, '.git/concord/issue-plan/v1/consumed', `${rejected.receiptId}.outcome.json`));
  error(execute(root, rejected), 'IssueRemoteRejected'); assert.equal(writes().length, 1);
  error(execute(root, rejected), 'IssuePlanConsumed');
})));


// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed concurrent execute consumes the receipt exactly once across processes', async () => {
  const root = consumer('concurrent'); mode(); const receipt = plan(root, 'close');
  const service = makeOwnedProcessService();
  const argv = [process.execPath, packedCli, '--root', root, 'issue', 'execute', receipt.receiptId, '--connection', connection.id, '--authorize', receipt.authorize, '--json'];
  const results = await Effect.runPromise(Effect.all([1, 2].map(() => Effect.scoped(service.run(argv, { cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` }, timeoutMs: 20_000 }))), { concurrency: 2 }));
  assert.deepEqual(results.map(result => result.exitCode).sort(), [0, 1]);
  assert.equal((JSON.parse(results.find(result => result.exitCode === 1)!.stderr) as { error: string }).error, 'IssuePlanConsumed');
  assert.equal(writes().length, 1);
  const outcome = JSON.parse(readFileSync(join(root, '.git/concord/issue-plan/v1/consumed', `${receipt.receiptId}.outcome.json`), 'utf8')) as { state: string };
  assert.equal(outcome.state, 'applied');
});
