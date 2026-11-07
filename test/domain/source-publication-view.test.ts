import assert from 'node:assert/strict';
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Deferred, Effect, Fiber, Layer } from 'effect';
import { makeRuntimeEnvironment, RuntimeEnvironment } from '../../src/base/environment/index.ts';
import { Publication, releaseTraceLeaseSync } from '../../src/base/publication/index.ts';
import { Sources } from '../../src/base/sources/index.ts';
import { SourcePublication } from '../../src/base/sources/publication-view.ts';
import { Workspace, WorkspaceContext } from '../../src/base/workspace/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { publicationLayer } from '../support/repository.ts';

const live = Layer.mergeAll(Workspace.layer, Sources.layer, publicationLayer).pipe(Layer.provide(NodeServices.layer));
const runtime = makeRuntimeEnvironment(process.cwd(), process.env);

// @feature docs/feature/portable-coordination/README.md
test('publication view verifies asynchronous validation and seals bytes, membership and metadata together', async () => {
  const root = (await createConsumer());
  writeFileSync(join(root, 'docs/input.md'), '# Before\n');
  try {
    await Effect.runPromise(Effect.gen(function*() {
      const sources = yield* Sources, publication = yield* Publication, workspace = yield* Workspace;
      const context = yield* workspace.open(root, { access: 'write', cache: 'off' });
      let retained: SourcePublication['Service'] | undefined;
      const result = yield* sources.snapshot(Effect.gen(function*() {
        const view = yield* SourcePublication;
        retained = view;
        yield* sources.readBytes('docs/input.md');
        yield* sources.files('docs');
        yield* sources.rootFiles;
        yield* sources.inspect('docs/input.md');
        yield* sources.exists('added.txt');
        yield* Effect.scoped(Effect.gen(function*() {
          const lease = yield* publication.lease(root, 'source-publication-view');
          assert(lease);
          yield* view.withLease(lease, Effect.gen(function*() {
            yield* Effect.yieldNow;
            assert.equal(yield* sources.read('docs/input.md'), '# Before\n');
            yield* view.verify;
            // Stand in only for the file replacement boundary. The production
            // Sources observation and real publication lease are used here.
            writeFileSync(join(root, 'docs/input.md'), '# After\n');
            chmodSync(join(root, 'docs/input.md'), 0o600);
            writeFileSync(join(root, 'docs/created.md'), '# Created\n');
            writeFileSync(join(root, 'added.txt'), 'new member\n');
            yield* view.seal;
          }));
        }));
        const sealedRead = yield* Effect.result(sources.read('docs/input.md'));
        assert.equal(sealedRead._tag, 'Failure');
        if (sealedRead._tag === 'Failure') assert.equal(sealedRead.failure.code, 'OperationFailed');
        return 'committed';
      })).pipe(Effect.provideService(WorkspaceContext, context));
      assert.equal(result, 'committed');
      const closed = yield* Effect.result(retained!.verify);
      assert.equal(closed._tag, 'Failure');
      const fresh = yield* workspace.open(root, { access: 'read', cache: 'off' });
      assert.equal(yield* sources.snapshot(sources.read('docs/input.md')).pipe(Effect.provideService(WorkspaceContext, fresh)), '# After\n');
    }).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, runtime)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/portable-coordination/README.md
test('publication view rejects precommit drift and never seals failed validation', async () => {
  const root = (await createConsumer());
  writeFileSync(join(root, 'docs/input.md'), '# Before\n');
  try {
    await Effect.runPromise(Effect.gen(function*() {
      const sources = yield* Sources, publication = yield* Publication;
      const context = yield* (yield* Workspace).open(root, { access: 'write', cache: 'off' });
      let evaluated = false;
      const drift = yield* Effect.result(sources.snapshot(Effect.gen(function*() {
        yield* sources.readBytes('docs/input.md');
        const view = yield* SourcePublication;
        writeFileSync(join(root, 'docs/input.md'), '# Changed\n');
        yield* Effect.scoped(Effect.gen(function*() {
          const lease = yield* publication.lease(root, 'reject-drift');
          assert(lease);
          yield* view.withLease(lease, Effect.sync(() => { evaluated = true; }));
        }));
      })).pipe(Effect.provideService(WorkspaceContext, context)));
      assert.equal(drift._tag, 'Failure');
      if (drift._tag === 'Failure') assert.equal(drift.failure.code, 'SourceChanged');
      assert.equal(evaluated, false);
      const failure = yield* Effect.result(sources.snapshot(Effect.gen(function*() {
        const view = yield* SourcePublication;
        yield* sources.read('docs/input.md');
        yield* Effect.scoped(Effect.gen(function*() {
          const lease = yield* publication.lease(root, 'failed-validation');
          assert(lease);
          const failed = yield* Effect.result(view.withLease(lease, Effect.fail('validation failed')));
          assert.equal(failed._tag, 'Failure');
        }));
        // A caught validation failure must leave ordinary return-time checks.
        writeFileSync(join(root, 'docs/input.md'), '# Drift after failure\n');
      })).pipe(Effect.provideService(WorkspaceContext, context)));
      assert.equal(failure._tag, 'Failure');
      if (failure._tag === 'Failure') assert.equal(failure.failure.code, 'SourceChanged');
    }).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, runtime)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/portable-coordination/README.md
test('publication view cannot use another workspace lease, a released lease or an unbound sibling', async () => {
  const root = (await createConsumer()), other = (await createConsumer());
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const sources = yield* Sources, publication = yield* Publication;
      const context = yield* (yield* Workspace).open(root, { access: 'write', cache: 'off' });
      yield* sources.snapshot(Effect.gen(function*() {
        const view = yield* SourcePublication;
        const foreign = yield* publication.lease(other, 'foreign-view');
        assert(foreign);
        const mismatch = yield* Effect.result(view.withLease(foreign, Effect.void));
        assert.equal(mismatch._tag, 'Failure');
        const released = yield* Effect.scoped(publication.lease(root, 'released-view'));
        assert(released);
        assert.equal((yield* Effect.result(view.withLease(released, Effect.void)))._tag, 'Failure');
        const lease = yield* publication.lease(root, 'current-view');
        assert(lease);
        const entered = yield* Deferred.make<void>();
        const child = yield* Effect.forkChild(view.withLease(lease, Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never))));
        yield* Deferred.await(entered);
        const sibling = yield* Effect.result(view.seal);
        assert.equal(sibling._tag, 'Failure');
        yield* Fiber.interrupt(child);
        // Cancellation releases only the borrowed view, never the owner lease.
        yield* view.withLease(lease, sources.rootFiles);
        assert.equal((yield* Effect.result(view.seal))._tag, 'Failure');
        yield* view.withLease(lease, Effect.gen(function*() {
          releaseTraceLeaseSync(lease, 'simulate-lost-source-lease');
          assert.equal((yield* Effect.result(view.verify))._tag, 'Failure');
          assert.equal((yield* Effect.result(view.seal))._tag, 'Failure');
        }));
      })).pipe(Effect.provideService(WorkspaceContext, context));
    })).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, runtime)));
  } finally { for (const path of [root, other]) rmSync(path, { recursive: true, force: true }); }
});
