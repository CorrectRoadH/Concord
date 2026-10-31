import { initialize } from '../support/operations.js';
import { runApplication } from '../support/repository.js';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from '../support/temporary.js';
import test from 'node:test';
import { Effect, Fiber } from 'effect';
import { LocalRepository } from "../support/repository.js";

import { collectNativeTests, readNativeObservations } from "../../src/domain/tests/index.js";
import { makeOwnedProcessService, OwnedProcess, OwnedProcessLive, runOwnedProcess } from "../../src/base/process/index.js";
import { inspectRunner, invalidateActiveRun } from "../../src/base/publication/index.js";
import { readProjectConfig, writeProjectConfig } from '../support/support.js';
import { pollUntil } from '../support/support.js';

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

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name adapter-config-repository-paths-c17
test('repository loading rejects symlinks in every configured adapter input path (C17)', () => runApplication(Effect.scoped(Effect.gen(function* () {
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
test('unknown adapter cleanup quarantines the same runner domain before another collect can start (C12)', () => runApplication(Effect.scoped(Effect.gen(function* () {
  const root = yield* consumer;
  const repo = yield* Effect.acquireRelease(Effect.sync(() => new LocalRepository(root)), repo => Effect.sync(() => repo.close()));
  // Only the OS permission boundary is injected. OwnedProcess still runs and
  // drains the real Node child, and the runner writes its actual quarantine.
  const owned = makeOwnedProcessService({ groupPresence: { kill: () => { throw Object.assign(new Error('permission denied'), { code: 'EPERM' }); } } });
  const first = yield* collectNativeTests(repo, ['test/sample.ts']).pipe(Effect.provideService(OwnedProcess, owned), Effect.exit);
  assert.equal(first._tag, 'Failure'); assert.equal(inspectRunner(root).status, 'blocked');
  const second = yield* collectNativeTests(repo, ['test/sample.ts']).pipe(Effect.provideService(OwnedProcess, owned), Effect.exit);
  assert.equal(second._tag, 'Failure'); assert.deepEqual(readNativeObservations(repo), []);
})).pipe(Effect.provide(OwnedProcessLive))));

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name adapter-invalidation-epoch-c10
test('an invalidated collect epoch cannot publish an otherwise successful observation (C10)', () => runApplication(Effect.scoped(Effect.gen(function* () {
  const root = yield* consumer;
  const repo = yield* Effect.acquireRelease(Effect.sync(() => new LocalRepository(root)), repo => Effect.sync(() => repo.close()));
  yield* Effect.sync(() => {
    mkdirSync(join(root, 'control'));
    writeFileSync(join(root, 'adapter.ts'), `import { existsSync, watch, writeFileSync } from 'node:fs';
let source = ''; for await (const chunk of process.stdin) source += chunk;
const request = JSON.parse(source);
if (request.op === 'collect-plan') {
  writeFileSync('control/started', 'ready');
  await new Promise(resolve => {
    const listener = watch('control', () => { if (existsSync('control/release')) { listener.close(); resolve(); } });
    if (existsSync('control/release')) { listener.close(); resolve(); }
  });
}
const payload = request.op === 'collect-plan'
  ? { invocations: [{ invocationId: 'collect', argv: [process.execPath, '-e', ''], cwd: '.', envNames: [], reports: [] }], planContext: {} }
  : { cases: [], capabilities: { realCollection: true, leaf: false, parameterGroups: false, exactSelection: false, perItemReport: false, range: false, rangeTrivia: false, tags: false, skipVisibility: false }, completeness: { complete: false, gaps: ['Fixture'] } };
process.stdout.write(JSON.stringify({ format: 'concord.test-adapter/v1', op: request.op, requestId: request.requestId, planId: request.context.planId, inputs: request.context.inputs, payload }));
`);
  });
  const collecting = yield* Effect.forkChild(collectNativeTests(repo, ['test/sample.ts']).pipe(Effect.exit));
  yield* Effect.promise(() => pollUntil(async () => existsSync(join(root, 'control/started')) ? true : undefined, { description: 'external adapter reached collect-plan' }));
  yield* Effect.sync(() => { repo.snapshot(() => invalidateActiveRun(root)); writeFileSync(join(root, 'control/release'), 'continue'); });
  const result = yield* Fiber.join(collecting);
  assert.equal(result._tag, 'Failure'); assert.deepEqual(readNativeObservations(repo), []); assert.equal(inspectRunner(root).status, 'absent');
})).pipe(Effect.provide(OwnedProcessLive))));
