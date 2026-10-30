import { packageBin, packConcord, installConcord, assert, execFileSync, spawnSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, tmpdir, join, resolve, test, Effect, Schema, makeOwnedProcessService, LocalRepository, initialize, setConfig, showConfig, type Call, type Receipt, connection, issue, scratch, bin, scenarioFile, callsFile, packedCli, consumer, mode, calls, writes, cli, plan, execute, error, alterReceipt } from '../support/issue-remote-fixture.js';


// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('packed write deadline produces uncertain outcome and a fresh close observes applied state', { skip: process.platform === 'win32', timeout: 240_000 }, () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('write-timeout'); mode({ hangWrite: true }); const receipt = plan(root, 'close');
  error(execute(root, receipt), 'IssueMutationUncertain'); assert.equal(writes().length, 1);
  error(cli(root, ['plan', 'close', '12', '--connection', connection.id]), 'IssueNoChange');
})));
