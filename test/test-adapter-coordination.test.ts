import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { Effect } from 'effect';
import { initialize, LocalRepository } from '../dist/storage.js';
import { collectNativeTests, readNativeObservations } from '../dist/test-adapters.js';
import { OwnedProcess, OwnedProcessLive, runOwnedProcess, type OwnedProcessResult, type OwnedProcessService } from '../dist/owned-process.js';
import { inspectRunner, invalidateActiveRun } from '../dist/run-coordination.js';
import { readProjectConfig, writeProjectConfig } from './support.js';

const emptyResult: OwnedProcessResult = { command: ['fixture'], exitCode: 0, signal: null, timedOut: false, cancelled: false, outputLimitExceeded: false, stdout: '', stderr: '', outputBytes: 0, processGroupOwned: true, groupCleanup: { owned: true, checked: true, aliveAfterLeaderClose: false, groupId: 999999, signalsSent: [], gone: true, detail: 'external boundary fixture' } };
const consumer = Effect.acquireRelease(Effect.gen(function* () {
  const root = yield* Effect.sync(() => mkdtempSync(join(tmpdir(), 'concord-adapter-coordination-')));
  yield* runOwnedProcess(['git', 'init', '-q', root], { cwd: root }).pipe(Effect.scoped);
  yield* Effect.sync(() => {
    const repo = new LocalRepository(root, { initialize: true }); try { initialize(repo); } finally { repo.close(); }
    mkdirSync(join(root, 'test')); writeFileSync(join(root, 'test/sample.ts'), '// fixture\n'); writeFileSync(join(root, 'adapter.ts'), '// fixture adapter\n');
    writeProjectConfig(root, { ...readProjectConfig(root), testAdapters: [{ id: 'fixture', include: ['test'], argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], frameworkVersion: 'fixture/v1', lockFiles: [], envNames: [] }] });
  });
  return root;
}), root => Effect.sync(() => rmSync(root, { recursive: true, force: true })));
const service = (run: OwnedProcessService['run']): OwnedProcessService => ({ run, requestStop: () => Effect.void, stop: () => Effect.void, forceKill: Effect.void, activeCount: Effect.succeed(0), awaitIdle: Effect.void, cleanupResults: Effect.succeed([]) });

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name adapter-config-repository-paths-c17
test('repository loading rejects symlinks in every configured adapter input path (C17)', () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const root = yield* consumer;
  yield* Effect.sync(() => {
    const config = readProjectConfig(root); const adapter = config.testAdapters![0]!;
    symlinkSync(root, join(root, 'test/escape'), 'dir');
    for (const field of ['include', 'inputRoots', 'implementationFiles', 'lockFiles'] as const) {
      writeProjectConfig(root, { ...config, testAdapters: [{ ...adapter, [field]: ['test/escape'] }] });
      assert.throws(() => new LocalRepository(root), { code: 'UnsafePath' }, field);
    }
  });
})).pipe(Effect.provide(OwnedProcessLive))));

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name adapter-cleanup-unknown-c12
test('unknown adapter cleanup quarantines the same runner domain before another collect can start (C12)', () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const root = yield* consumer;
  const repo = yield* Effect.acquireRelease(Effect.sync(() => new LocalRepository(root)), repo => Effect.sync(() => repo.close()));
  const fake = service(() => Effect.succeed({ ...emptyResult, groupCleanup: { ...emptyResult.groupCleanup, gone: null, detail: 'fixture cannot confirm cleanup' } }));
  const first = yield* collectNativeTests(repo, ['test/sample.ts']).pipe(Effect.provideService(OwnedProcess, fake), Effect.exit);
  assert.equal(first._tag, 'Failure'); assert.equal(inspectRunner(root).status, 'blocked');
  const second = yield* collectNativeTests(repo, ['test/sample.ts']).pipe(Effect.provideService(OwnedProcess, fake), Effect.exit);
  assert.equal(second._tag, 'Failure'); assert.deepEqual(readNativeObservations(repo), []);
})).pipe(Effect.provide(OwnedProcessLive))));

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name adapter-invalidation-epoch-c10
test('an invalidated collect epoch cannot publish an otherwise successful observation (C10)', () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const root = yield* consumer;
  const repo = yield* Effect.acquireRelease(Effect.sync(() => new LocalRepository(root)), repo => Effect.sync(() => repo.close()));
  const fake = service((_argv, options) => Effect.sync(() => {
    if (!options.stdin) return emptyResult;
    const request = JSON.parse(options.stdin) as { op: string; requestId: string; context: { planId: string; inputs: string } };
    if (request.op === 'collect-plan') repo.snapshot(() => invalidateActiveRun(root));
    const payload = request.op === 'collect-plan' ? { invocations: [{ invocationId: 'collect', argv: ['fixture'], cwd: '.', envNames: [], reports: [] }], planContext: {} } : { cases: [], capabilities: { realCollection: true, leaf: false, parameterGroups: false, exactSelection: false, perItemReport: false, range: false, rangeTrivia: false, tags: false, skipVisibility: false }, completeness: { complete: false, gaps: ['Fixture'] } };
    return { ...emptyResult, stdout: JSON.stringify({ format: 'concord.test-adapter/v1', op: request.op, requestId: request.requestId, planId: request.context.planId, inputs: request.context.inputs, payload }) };
  }));
  const result = yield* collectNativeTests(repo, ['test/sample.ts']).pipe(Effect.provideService(OwnedProcess, fake), Effect.exit);
  assert.equal(result._tag, 'Failure'); assert.deepEqual(readNativeObservations(repo), []); assert.equal(inspectRunner(root).status, 'absent');
})).pipe(Effect.provide(OwnedProcessLive))));
