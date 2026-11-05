import { packageBin, sourceConcord, prepareSourceConsumer, assert, execFileSync, spawnSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, tmpdir, join, resolve, test, Effect, Schema, makeOwnedProcessService, LocalRepository, initialize, setConfig, showConfig, type Call, type Receipt, connection, issue, scratch, bin, scenarioFile, callsFile, packedCli, consumer, mode, calls, writes, cli, plan, execute, error, alterReceipt } from '../support/issue-remote-fixture.js';
// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed previews reject PR, unbound/API connections, no change, invalid labels and output/page budgets', () => Effect.runPromise(Effect.sync(() => {
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
    writeFileSync(join(root, 'body.txt'), 'body'); mode(extra); error(cli(root, ['preview', ...args, '--connection', connection.id]), code); assert.equal(writes().length, 0);
  }
  assert.equal(existsSync(join(root, '.git/concord/issue-plan/v1/planned')), false, 'failed plan must not sign a receipt');
  const unbound = consumer('unbound', { ...connection, repositoryId: undefined }); mode(); error(cli(unbound, ['preview', 'close', '12', '--connection', connection.id]), 'IssueConnectionUnbound'); assert.equal(calls().length, 0);
  const api = consumer('api', { ...connection, transport: 'api', credentialEnv: 'TEST_TOKEN' }); mode(); error(cli(api, ['preview', 'close', '12', '--connection', connection.id]), 'IssueRemoteTransportUnsupported'); assert.equal(calls().length, 0);
})));
