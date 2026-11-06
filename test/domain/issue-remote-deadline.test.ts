import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Clock, Effect, Fiber, Result } from 'effect';
import { IssueMutationUncertain, IssueNoChange } from '../../src/model/index.ts';
import { TestClock } from 'effect/testing';
import { OwnedProcess, makeOwnedProcessService } from '../../src/base/process/index.ts';
import { makeNodeIssueCommandRunner, planRemoteIssue, executeRemoteIssue, setConfig, showConfig } from '../../src/app/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { tmpdir } from '../support/temporary.ts';
import { pollUntil } from '../support/support.ts';
import { writeGhFixture } from '../support/gh-fixture.ts';

// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('write deadline produces uncertain outcome and a fresh close observes applied state', { skip: process.platform === 'win32', timeout: 30_000 }, async () => {
  const root = createConsumer(), scratch = mkdtempSync(join(tmpdir(), 'concord-gh-deadline-'));
  const bin = join(scratch, 'bin'), scenarioFile = join(scratch, 'scenario.json'), callsFile = join(scratch, 'calls.ndjson');
  writeGhFixture(bin, scenarioFile, callsFile);
  const connection = { id: 'product-gh', provider: 'github', transport: 'gh', owner: 'example', repo: 'product', repositoryId: '42' } as const;
  const repository = new LocalRepository(root);
  try { const config = showConfig(repository); setConfig(repository, { ...config.config, feedbackConnections: [connection] }, config.digest); }
  finally { repository.close(); }
  const issue = { number: 12, html_url: 'https://github.com/example/product/issues/12', title: 'Planned title', body: 'initial', state: 'open', labels: [{ name: 'old' }] };
  writeFileSync(scenarioFile, JSON.stringify({ issue, list: [], hangWrite: true })); writeFileSync(callsFile, '');
  const realProcesses = makeOwnedProcessService();
  const processes = { ...realProcesses, environment: { ...realProcesses.environment, env: { ...realProcesses.environment.env, PATH: `${bin}:${process.env.PATH ?? ''}`, GH_DEBUG: 'api', GH_REPO: 'attacker/other' } } };
  try {
    await runApplication(Effect.scoped(Effect.gen(function*() {
      const clock = yield* TestClock.make(); yield* clock.setTime(Date.now());
      const run = makeNodeIssueCommandRunner(root);
      const receipt = yield* run(connection.id, false, planRemoteIssue(connection.id, 12, { operation: 'close' }));
      const execution = yield* run(connection.id, true, executeRemoteIssue(connection.id, receipt.receiptId, receipt.authorize)).pipe(Effect.result, Effect.provideService(Clock.Clock, clock), Effect.forkChild);
      yield* Effect.tryPromise(() => pollUntil(async () => {
        const calls = readFileSync(callsFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as { args: string[] });
        const writes = calls.filter(call => call.args.includes('--method') && call.args[call.args.indexOf('--method') + 1] !== 'GET');
        return writes.length === 1 && (JSON.parse(readFileSync(scenarioFile, 'utf8')) as { issue: { state: string } }).issue.state === 'closed' ? writes : undefined;
      }));
      yield* clock.adjust('121 seconds');
      const outcome = yield* Fiber.join(execution);
      assert.ok(Result.isFailure(outcome)); assert.ok(outcome.failure instanceof IssueMutationUncertain);
      const calls = readFileSync(callsFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as { args: string[] });
      assert.equal(calls.filter(call => call.args.includes('--method') && call.args[call.args.indexOf('--method') + 1] !== 'GET').length, 1);
      const fresh = yield* run(connection.id, false, planRemoteIssue(connection.id, 12, { operation: 'close' })).pipe(Effect.result);
      assert.ok(Result.isFailure(fresh)); assert.ok(fresh.failure instanceof IssueNoChange);
      assert.equal(yield* processes.activeCount, 0);
      assert.ok((yield* processes.cleanupResults).every(result => !result.processGroupOwned || result.groupCleanup.gone === true));
    })).pipe(Effect.provideService(OwnedProcess, processes)));
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});
