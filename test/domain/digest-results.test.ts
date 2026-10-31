import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Deferred, Effect, Fiber, Stream, SubscriptionRef } from 'effect';
import { TestClock } from 'effect/testing';
import { workspaceSourceDigest } from '../../src/app/workspace-source.js';
import { workspaceEvents, WorkspaceState } from '../../src/entry/server/state.js';
import { makeWorkspaceService } from '../../src/entry/server/service.js';
import { LocalRepository, runApplication } from '../support/repository.js';
import { fixture } from '../support/workspace-projection-fixture.js';
import { record, projection, ports, stateLayer } from '../support/workspace-service-fixture.js';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('workspace source identity survives ABA between refreshes and includes supporting sources', async () => {
  const root = fixture();
  try {
    const path = join(root, 'docs/feature/projected/README.md');
    const original = readFileSync(path, 'utf8');
    const before = await runApplication(workspaceSourceDigest(root));
    writeFileSync(path, original + '\nChanged.\n');
    assert.notEqual(await runApplication(workspaceSourceDigest(root)), before);
    writeFileSync(path, original);
    assert.equal(await runApplication(workspaceSourceDigest(root)), before);
    writeFileSync(join(root, 'docs/extra.md'), '# Extra\n');
    assert.notEqual(await runApplication(workspaceSourceDigest(root)), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
test('each subscription sends one result for an unchanged sourceDigest while forwarding state and attempt events', async () => {
  const event = { token: 'instance', sourceDigest: record.sourceDigest, state: 'running' as const, workspace: projection };
  const updated = { ...event, workspace: { ...projection, projection: { ...projection.projection, lastAttempt: { at: record.builtAt, complete: false, changedPaths: ['docs/extra.md'] } } } };
  const source = workspaceEvents(Stream.fromIterable([event, updated, { ...event, state: 'stopping' as const }]));
  for (let reconnect = 0; reconnect < 2; reconnect++) {
    const events = await Effect.runPromise(Stream.runCollect(source));
    assert.equal(events.length, 3);
    assert.deepEqual(events[0]?.workspace, projection);
    assert.equal(events[1]?.workspace, undefined);
    assert.deepEqual(events[1]?.projection?.lastAttempt?.changedPaths, ['docs/extra.md']);
    assert.equal(events[2]?.state, 'stopping');
    assert.equal(events[2]?.workspace, undefined);
  }
});

// @feature docs/feature/local-data-engine/README.md
test('a changed source digest discards the late candidate before persistent publication', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const started = yield* Deferred.make<void>(), finish = yield* Deferred.make<unknown>();
  let sourceDigest = record.sourceDigest, writes = 0, scans = 0;
  const service = yield* makeWorkspaceService(ports({
    sourceDigest: Effect.sync(() => sourceDigest),
    compute: () => Effect.suspend(() => ++scans === 1 ? Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(finish))) : Effect.never),
    persist: () => Effect.sync(() => { writes++; }),
  }));
  yield* Deferred.await(started);
  sourceDigest = 'changed';
  yield* service.request;
  yield* Deferred.succeed(finish, record);
  yield* TestClock.adjust(0);
  assert.equal(writes, 0);
  assert.equal(scans, 2);
  assert.equal((yield* SubscriptionRef.get(service.state.value)).sourceDigest, record.sourceDigest);
  yield* service.stop;
})).pipe(Effect.provide(stateLayer))));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('final source verification detects a completed multi-file publication inside a read', () => {
  const root = fixture();
  const reader = new LocalRepository(root, { access: 'read', optimistic: true });
  const writer = new LocalRepository(root);
  try {
    writeFileSync(join(root, 'memory/a.md'), 'old-a');
    writeFileSync(join(root, 'memory/b.md'), 'old-b');
    assert.throws(() => reader.snapshot(() => {
      assert.equal(reader.read('memory/a.md'), 'old-a');
      writer.publish('replace-pair', [
        { path: 'memory/a.md', before: 'old-a', after: 'new-a' },
        { path: 'memory/b.md', before: 'old-b', after: 'new-b' },
      ]);
      assert.equal(reader.read('memory/b.md'), 'new-b');
    }), { code: 'SourceChanged' });
  } finally { reader.close(); writer.close(); rmSync(root, { recursive: true, force: true }); }
});
