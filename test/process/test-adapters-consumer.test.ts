import { packageBin, assert, existsSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, join, tmpdir, fileURLToPath, test, Effect, Schema, OwnedProcessLive, hasSuccessfulOwnedProcessResult, runOwnedProcess, ProjectSchema, renderTypeScriptConfig, parseTypeScriptConfig, type TestAdapter, LocalRepository, closeRepositoryCache, withPersistentCache, installConcord, packConcord, sourceRoot, text, scratch, command, requireCommand, parse, CaseList, Receipt, setup, prepare, configure, call, success, idFor, environment, builtin } from '../support/test-adapters-consumer-fixture.js';


import { externalCase } from '../support/external-adapter-fixture.js';

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name packed-external-adapter-boundaries
test('packed external adapter preserves static relations and rejects dishonest protocol/report outcomes (C1-C5 C7-C16)', { skip: process.platform !== 'linux' && 'Native report directory-handle traversal is not verified on this platform' }, () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const { consumer, cli, id } = yield* externalCase();
  const checkBefore = yield* success(consumer, cli, ['check']);
  const coldCases = Schema.decodeUnknownSync(CaseList)(JSON.parse((yield* success(consumer, cli, ['test', 'list'])).stdout)).cases;
  yield* success(consumer, cli, ['test', 'discover']);
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
    if (state === 'warm') yield* success(consumer, cli, ['test', 'discover']);
    if (state === 'corrupt') yield* Effect.sync(corruptObservation);
    if (state === 'clear') yield* success(consumer, cli, ['cache', 'clear']);
    const checked = yield* call(consumer, cli, ['check']); assert.equal(checked.exitCode, 1);
    const result = parse(checked.stdout); const stable = { ok: result.ok, complete: result.complete, findings: result.findings };
    if (wrongSource === undefined) wrongSource = stable; else assert.deepEqual(stable, wrongSource, state);
    assert.ok(Array.isArray(result.findings) && result.findings.length > 0);
  }
  yield* Effect.sync(() => text(consumer, 'test/sample.ts', markedSource));
  yield* success(consumer, cli, ['test', 'discover']);
  const observationState = (source: string) => Schema.decodeUnknownSync(Schema.Struct({ observations: Schema.Array(Schema.Struct({ observation: Schema.Struct({ current: Schema.Boolean, inputs: Schema.String }) })) }))(JSON.parse(source)).observations[0]!.observation;
  const scriptBefore = observationState((yield* success(consumer, cli, ['test', 'list'])).stdout);
  yield* Effect.sync(() => text(consumer, 'adapter.ts', readFileSync(join(consumer, 'adapter.ts'), 'utf8') + '\n// implementation changed\n'));
  assert.equal(observationState((yield* success(consumer, cli, ['test', 'list'])).stdout).current, false);
  yield* success(consumer, cli, ['test', 'discover']);
  const scriptAfter = observationState((yield* success(consumer, cli, ['test', 'list'])).stdout);
  assert.equal(scriptAfter.current, true); assert.notEqual(scriptBefore.inputs, scriptAfter.inputs);
})).pipe(Effect.provide(OwnedProcessLive))));
