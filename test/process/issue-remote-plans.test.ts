// 跨进程保证：外部程序——真实gh读取输出超限或分页耗尽时拒绝计划且不签发receipt。
import { assert, existsSync, writeFileSync, join, test, Effect, connection, issue, consumer, mode, writes, cli, error } from '../support/issue-remote-fixture.ts';
// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('remote previews retain gh reads, output/page budgets and CLI InvalidInput mapping', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await consumer('reject-plans'));
  for (const [extra, args, code] of [
    [{ issue: issue(12, { pull_request: {}, html_url: 'https://github.com/example/product/pull/12' }) }, ['close', '12'], 'IssueTargetIsPullRequest'],
    [{ issue: issue(12, { state: 'closed' }) }, ['close', '12'], 'IssueNoChange'],
    [{}, ['reopen', '12'], 'IssueNoChange'],
    [{}, ['labels-add', '12', '--label', 'old'], 'IssueNoChange'],
    [{}, ['labels-remove', '12', '--label', 'missing'], 'IssueNoChange'],
    [{}, ['labels-add', '12', '--label', 'x'.repeat(51)], 'InvalidInput'],
    [{ oversize: true }, ['close', '12'], 'IssueRemoteBudgetExceeded'],
    [{ pages: true, issue: issue(12, { body: 'x'.repeat(16000) }) }, ['create', '--title', 'x', '--body', join(root, 'body.txt')], ['IssueRemoteBudgetExceeded', 'GhTimeout']],
    [{ pages: true }, ['create', '--title', 'x', '--body', join(root, 'body.txt')], ['IssueRemoteBudgetExceeded', 'GhTimeout']],
  ] as const) {
    writeFileSync(join(root, 'body.txt'), 'body'); mode(extra); error(cli(root, ['preview', ...args, '--connection', connection.id]), code); assert.equal(writes().length, 0);
  }
  assert.equal(existsSync(join(root, '.git/concord/issue-plan/v1/planned')), false, 'failed plan must not sign a receipt');
})));
