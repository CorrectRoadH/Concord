import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { recoverLocalState } from '../../src/app/index.ts';
import { acquireTraceLeaseSync, beginRun, Publication, releaseTraceLeaseSync } from '../../src/base/publication/index.ts';
import { fixture } from '../support/publication-ownership-fixture.ts';
import { runApplication } from '../support/repository.ts';

// @use-case docs/feature/local-sdlc/use-case/recover-local-state.md#release-observation-slot
test('manual release reports the released token after another observation claims the slot', async t => {
  const root = await fixture(t);
  const dead = spawnSync('git', ['--version']);
  assert.equal(dead.status, 0);
  const { lease: previous } = beginRun(root, process.env);
  writeFileSync(join(previous.path, `${previous.owner.token}.json`), JSON.stringify({ ...previous.owner, pid: dead.pid }));
  let nextToken: string | undefined;
  const release = Effect.flatMap(Publication, publication => recoverLocalState(root, previous.owner.token).pipe(Effect.provideService(Publication, {
    ...publication,
    lease: (root, operation, create, reclaimDead) => Effect.gen(function* () {
      if (operation === 'recover-dispatch') {
        // Scope finalizers run in reverse order, so the next claimant acquires its own publication lease after dispatch releases its lease.
        yield* Effect.addFinalizer(() => Effect.sync(() => {
          const lease = acquireTraceLeaseSync(root, 'exclusive', 'next-observation', true, false, process.env);
          assert.ok(lease);
          try { nextToken = beginRun(root, process.env).lease.owner.token; }
          finally { releaseTraceLeaseSync(lease, 'next-observation'); }
        }));
      }
      return yield* publication.lease(root, operation, create, reclaimDead);
    }),
  })));

  const receipt = await runApplication(release);
  assert.ok(nextToken);
  assert.notEqual(nextToken, previous.owner.token);
  const latest = await runApplication(recoverLocalState(root));
  assert.equal(latest.observationSlot.status, 'running');
  assert.equal(latest.observationSlot.token, nextToken);
  assert.deepEqual(receipt.observationSlot, { status: 'released', token: previous.owner.token });
});
