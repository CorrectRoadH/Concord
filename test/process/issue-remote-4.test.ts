import { packageBin, packConcord, installConcord, assert, execFileSync, spawnSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, tmpdir, join, resolve, test, Effect, Schema, makeOwnedProcessService, LocalRepository, initialize, setConfig, showConfig, type Call, type Receipt, connection, issue, scratch, bin, scenarioFile, callsFile, packedCli, consumer, mode, calls, writes, cli, plan, execute, error, alterReceipt } from '../support/issue-remote-fixture.js';
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
