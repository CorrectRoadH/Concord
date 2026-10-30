import { packageBin, assert, existsSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, join, tmpdir, fileURLToPath, test, Effect, Schema, OwnedProcessLive, hasSuccessfulOwnedProcessResult, runOwnedProcess, ProjectSchema, renderTypeScriptConfig, parseTypeScriptConfig, type TestAdapter, LocalRepository, closeRepositoryCache, withPersistentCache, installConcord, packConcord, sourceRoot, text, scratch, command, requireCommand, parse, CaseList, Receipt, setup, prepare, configure, call, success, idFor, environment, builtin } from '../support/test-adapters-consumer-fixture.js';


// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name packed-external-adapter-boundaries
test('packed external adapter preserves static relations and rejects dishonest protocol/report outcomes (C1-C5 C7-C16)', { skip: process.platform !== 'linux' && 'Native report directory-handle traversal is not verified on this platform' }, () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const root = yield* scratch; const { cli, tool } = yield* setup(root, true);
  const consumer = yield* prepare(root, 'external', cli, tool);
  yield* Effect.sync(() => {
    copyFileSync(join(sourceRoot, 'test/fixtures/process-adapter.ts'), join(consumer, 'adapter.ts'));
    text(consumer, 'fixture.txt', 'original'); text(consumer, 'fixture.lock', 'locked'); text(consumer, 'mode.txt', 'green');
    text(consumer, 'test/sample.ts', '// @feature docs/feature/example/README.md\n// @name parameter-group\n// @issue docs/issues/problem.md\n');
    configure(consumer, [{ id: 'external', include: ['test'], argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], frameworkVersion: 'fixture/v1', lockFiles: ['fixture.lock'], envNames: ['NODE_OPTIONS', 'PATH'], collectTimeoutMs: 1000, budgets: { reportFileBytes: 128 } }]);
  });
  yield* success(consumer, cli, ['new', 'issue', 'problem', '--title', 'Problem']);
  const id = yield* idFor(consumer, cli);
  const checkBefore = yield* success(consumer, cli, ['check']);
  const coldCases = Schema.decodeUnknownSync(CaseList)(JSON.parse((yield* success(consumer, cli, ['test', 'list'])).stdout)).cases;
  yield* success(consumer, cli, ['test', 'collect']);
  const checkAfter = yield* success(consumer, cli, ['check']);
  const before = parse(checkBefore.stdout), after = parse(checkAfter.stdout);
  for (const field of ['ok', 'complete', 'findings', 'cases']) assert.deepEqual(after[field], before[field]);
  const corruptObservation = () => {
    const repo = new LocalRepository(consumer);
    try { repo.snapshot(() => withPersistentCache(repo, true, db => db!.put('annotation_cache', [{ key: 'native-manifest/v1/external', payload: '{broken' }]))); }
    finally { closeRepositoryCache(repo); repo.close(); }
  };
  for (const state of ['warm', 'corrupt', 'clear']) {
    if (state === 'corrupt') yield* Effect.sync(corruptObservation);
    if (state === 'clear') yield* success(consumer, cli, ['cache', 'clear']);
    const checked = parse((yield* success(consumer, cli, ['check'])).stdout);
    for (const field of ['ok', 'complete', 'findings']) assert.deepEqual(checked[field], before[field], state);
    assert.deepEqual(Schema.decodeUnknownSync(CaseList)(JSON.parse((yield* success(consumer, cli, ['test', 'list'])).stdout)).cases, coldCases, state);
  }
  const markedSource = readFileSync(join(consumer, 'test/sample.ts'), 'utf8');
  yield* Effect.sync(() => text(consumer, 'test/sample.ts', markedSource.replace('docs/feature/example/README.md', 'docs/feature/missing/README.md')));
  let wrongSource: unknown;
  for (const state of ['cold', 'warm', 'corrupt', 'clear']) {
    if (state === 'warm') yield* success(consumer, cli, ['test', 'collect']);
    if (state === 'corrupt') yield* Effect.sync(corruptObservation);
    if (state === 'clear') yield* success(consumer, cli, ['cache', 'clear']);
    const checked = yield* call(consumer, cli, ['check']); assert.equal(checked.exitCode, 1);
    const result = parse(checked.stdout); const stable = { ok: result.ok, complete: result.complete, findings: result.findings };
    if (wrongSource === undefined) wrongSource = stable; else assert.deepEqual(stable, wrongSource, state);
    assert.ok(Array.isArray(result.findings) && result.findings.length > 0);
  }
  yield* Effect.sync(() => text(consumer, 'test/sample.ts', markedSource));
  yield* success(consumer, cli, ['test', 'collect']);
  const observationState = (source: string) => Schema.decodeUnknownSync(Schema.Struct({ observations: Schema.Array(Schema.Struct({ observation: Schema.Struct({ current: Schema.Boolean, inputs: Schema.String }) })) }))(JSON.parse(source)).observations[0]!.observation;
  const scriptBefore = observationState((yield* success(consumer, cli, ['test', 'list'])).stdout);
  yield* Effect.sync(() => text(consumer, 'adapter.ts', readFileSync(join(consumer, 'adapter.ts'), 'utf8') + '\n// implementation changed\n'));
  assert.equal(observationState((yield* success(consumer, cli, ['test', 'list'])).stdout).current, false);
  yield* success(consumer, cli, ['test', 'collect']);
  const scriptAfter = observationState((yield* success(consumer, cli, ['test', 'list'])).stdout);
  assert.equal(scriptAfter.current, true); assert.notEqual(scriptBefore.inputs, scriptAfter.inputs);
  for (const mode of ['green', 'split', 'missing', 'duplicate', 'extra', 'skip', 'parser-failed', 'symlink', 'unexpected-report', 'large-report']) {
    yield* Effect.sync(() => text(consumer, 'mode.txt', mode));
    const run = yield* call(consumer, cli, ['test', 'run', id, '--require-native']);
    const receipt = Schema.decodeUnknownSync(Receipt)(JSON.parse(run.stdout));
    assert.equal(receipt.commandOutcome, ['green', 'split'].includes(mode) ? 'green' : 'invalid', `${mode}: ${run.stderr}\n${run.stdout}`);
    assert.equal(receipt.requested?.length, 2);
    if (mode === 'split') assert.equal(receipt.commandExecutionCount, 2);
  }
  for (const mode of ['wrong-echo', 'extra-envelope', 'duplicate-key', 'nonfinite', 'timeout', 'escape-report', 'drift', 'drift-config', 'drift-lock', 'drift-member']) {
    yield* Effect.sync(() => text(consumer, 'mode.txt', mode));
    const run = yield* call(consumer, cli, ['test', 'run', id, '--require-native']);
    assert.equal(run.exitCode, 1, mode); assert.match(run.stderr, /AdapterProtocolInvalid|ReportUnsafe|InputChanged/, mode);
  }
  yield* Effect.sync(() => { text(consumer, 'mode.txt', 'red'); text(consumer, 'fixture.txt', 'original'); });
  const red = Schema.decodeUnknownSync(Receipt)(JSON.parse((yield* call(consumer, cli, ['test', 'run', id, '--require-native'])).stdout)); assert.equal(red.commandOutcome, 'red');
  yield* Effect.sync(() => text(consumer, 'mode.txt', 'green'));
  const green = Schema.decodeUnknownSync(Receipt)(JSON.parse((yield* success(consumer, cli, ['test', 'run', id, '--require-native'])).stdout));
  assert.notEqual(red.definitionDigest, green.definitionDigest); assert.deepEqual(red.requested, green.requested); assert.ok(green.gaps?.includes('ExternalInputUnknown'));
  yield* success(consumer, cli, ['cache', 'clear']);
  assert.equal(yield* idFor(consumer, cli), id);
})).pipe(Effect.provide(OwnedProcessLive))));
