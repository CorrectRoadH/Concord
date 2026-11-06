import { packageBin, sourceConcord, prepareSourceConsumer, assert, execFileSync, spawnSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, tmpdir, join, resolve, test, Effect, Schema, makeOwnedProcessService, LocalRepository, initialize, setConfig, showConfig, type Call, type Receipt, connection, issue, scratch, bin, scenarioFile, callsFile, packedCli, consumer, mode, calls, writes, cli, plan, execute, error, alterReceipt } from '../support/issue-remote-fixture.ts';
// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed preview/apply binds authorization, consumes once, uses stdin and emits private outcome', () => Effect.runPromise(Effect.sync(() => {
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
  error(cli(root, ['preview', 'close', '12', '--connection', connection.id]), 'IssueNoChange');
})));

// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed apply rejects expired, drifted, corrupt and wrong repository plans without writes', () => Effect.runPromise(Effect.sync(() => {
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
