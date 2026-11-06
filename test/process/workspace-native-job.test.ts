import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { OwnedProcessLive } from '../../src/base/process/index.ts';
import { externalCase } from '../support/external-adapter-fixture.ts';
import { call } from '../support/test-adapters-consumer-fixture.ts';
import { pollUntil, fetchFresh, waitForWorkspaceProjection } from '../support/support.ts';
import { startViewServer } from '../e2e/server.ts';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('a native Web job returns derived observations to the persistent workspace owner', { timeout: 30_000 }, () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const { consumer, cli, id } = yield* externalCase();
  const server = yield* Effect.acquireRelease(Effect.promise(() => startViewServer({ root: consumer, installedBin: cli })), value => Effect.promise(() => value.close()));
  yield* Effect.promise(async () => {
    await waitForWorkspaceProjection(new URL(server.address).origin);
    const response = await fetchFresh(new URL('/api/jobs', server.address).href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId: id }) });
    const body: unknown = await response.json();
    assert.equal(response.status, 202, JSON.stringify(body));
    const started = Schema.decodeUnknownSync(Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({ id: Schema.String }) }))(body);
    const job = await pollUntil(async () => {
      const response = await fetchFresh(new URL('/api/jobs', server.address).href);
      const body = Schema.decodeUnknownSync(Schema.Struct({ ok: Schema.Literal(true), value: Schema.Array(Schema.Struct({ id: Schema.String, state: Schema.String, evidence: Schema.optional(Schema.Struct({ commandOutcome: Schema.String })), error: Schema.optional(Schema.Unknown) })) }))(await response.json());
      const job = body.value.find(value => value.id === started.value.id);
      return job && ['completed', 'failed', 'cleanup-failed'].includes(job.state) ? job : undefined;
    }, { description: 'native operation process returns its receipt and exits', timeoutMs: 15_000 });
    assert.equal(job.state, 'completed', JSON.stringify(job));
    assert.equal(job.evidence?.commandOutcome, 'green');
  });
  const listed = yield* call(consumer, cli, ['test', 'list']);
  assert.equal(listed.exitCode, 0, listed.stderr);
  const inventory = Schema.decodeUnknownSync(Schema.Struct({ observations: Schema.Array(Schema.Struct({ adapterId: Schema.String, observation: Schema.Struct({ value: Schema.Struct({ cases: Schema.Array(Schema.Unknown) }) }) })) }))(JSON.parse(listed.stdout));
  assert.equal(inventory.observations.find(item => item.adapterId === 'external')?.observation.value.cases.length, 2, 'the next computation receives observations merged by the main process');
})).pipe(Effect.provide(OwnedProcessLive))));
