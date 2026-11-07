import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { makeNodeIssueCommandRunner, planRemoteIssue, setConfig, showConfig } from '../../src/app/index.ts';
import { makeOwnedProcessService, OwnedProcess } from '../../src/base/process/index.ts';
import type { feedback_schema_FeedbackConnection as FeedbackConnection, IssuePayload } from '../../src/model/index.ts';
import { createConsumer } from './consumer.ts';
import { writeGhFixture } from './gh-fixture.ts';
import { LocalRepository, runApplication } from './repository.ts';
import { tmpdir } from './temporary.ts';

export const remoteIssueConnection = { id: 'product-gh', provider: 'github', transport: 'gh', owner: 'example', repo: 'product', repositoryId: '42' } as const;

/** Exercise the production composition root without starting its external transport. */
export async function remoteIssueConsumer(connection: FeedbackConnection = remoteIssueConnection) {
  const root = (await createConsumer());
  const scratch = mkdtempSync(join(tmpdir(), 'concord-issue-remote-domain-'));
  const bin = join(scratch, 'bin');
  const scenarioFile = join(scratch, 'scenario.json');
  const callsFile = join(scratch, 'calls.ndjson');
  writeGhFixture(bin, scenarioFile, callsFile);
  // No request should reach gh; a spawned fixture will fail on the absent scenario.
  const repository = (await LocalRepository.open(root));
  try {
    const config = showConfig(repository);
    (await setConfig(repository, { ...config.config, feedbackConnections: [connection] }, config.digest));
  } finally { repository.close(); }
  const owner = makeOwnedProcessService();
  const processes = { ...owner, environment: { ...owner.environment, env: { ...owner.environment.env, PATH: `${bin}:${owner.environment.env.PATH ?? ''}`, GH_DEBUG: 'api', GH_REPO: 'attacker/other' } } };
  return {
    root,
    preview: (payload: IssuePayload) => runApplication(makeNodeIssueCommandRunner(root)(connection.id, false, planRemoteIssue(connection.id, 12, payload)).pipe(Effect.provideService(OwnedProcess, processes))),
    calls: () => {
      try { return readFileSync(callsFile, 'utf8'); }
      catch (cause) { if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return ''; throw cause; }
    },
    processes: () => Effect.runPromise(processes.cleanupResults),
    close: async () => {
      await Effect.runPromise(processes.awaitIdle);
      rmSync(root, { recursive: true, force: true });
      rmSync(scratch, { recursive: true, force: true });
    },
  };
}
