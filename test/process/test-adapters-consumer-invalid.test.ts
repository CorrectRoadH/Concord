import { sourceCli, assert, existsSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, join, tmpdir, fileURLToPath, test, Effect, Schema, OwnedProcessLive, hasSuccessfulOwnedProcessResult, runOwnedProcess, ProjectSchema, renderTypeScriptConfig, parseTypeScriptConfig, type TestAdapter, LocalRepository, closeRepositoryCache, withPersistentCache, prepareSourceConsumer, sourceRoot, text, scratch, command, requireCommand, parse, CaseList, Receipt, setup, prepare, configure, call, success, idFor, environment, builtin } from '../support/test-adapters-consumer-fixture.ts';


import { externalCase } from '../support/external-adapter-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name packed-external-adapter-invalid-boundaries
test('external adapter preserves invalid-source findings across cold warm corrupt and cleared caches', { skip: process.platform !== 'linux' && 'Native report directory-handle traversal is not verified on this platform' }, () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const { consumer, cli, id } = yield* externalCase();
  yield* Effect.addFinalizer(() => call(consumer, cli, ['server', 'stop']).pipe(Effect.tap(result => Effect.sync(() => assert.equal(result.exitCode, 0, result.stderr))), Effect.asVoid, Effect.orDie));
  // Recreate the valid cached source that precedes the invalid-source phase.
  yield* success(consumer, cli, ['cache', 'clear']);
  yield* success(consumer, cli, ['check']);
  yield* success(consumer, cli, ['test', 'list']);
  const corruptObservation = () => {
    const repo = new LocalRepository(consumer);
    try { repo.snapshot(() => withPersistentCache(repo, true, db => db!.put('annotation_cache', [{ key: 'native-manifest/v1/external', payload: '{broken' }]))); }
    finally { closeRepositoryCache(repo); repo.close(); }
  };
  const markedSource = readFileSync(join(consumer, 'test/sample.ts'), 'utf8');
  yield* Effect.sync(() => text(consumer, 'test/sample.ts', markedSource.replace('docs/feature/example/README.md', 'docs/feature/missing/README.md')));
  let wrongSource: unknown;
  for (const state of ['cold', 'warm', 'corrupt', 'clear']) {
    if (state === 'warm') yield* success(consumer, cli, ['test', 'discover']);
    if (state === 'corrupt') { yield* success(consumer, cli, ['server', 'stop']); yield* Effect.sync(corruptObservation); }
    if (state === 'clear') yield* success(consumer, cli, ['cache', 'clear']);
    const checked = yield* call(consumer, cli, ['check']); assert.equal(checked.exitCode, 1);
    const result = parse(checked.stdout); const stable = { ok: result.ok, complete: result.complete, findings: result.findings };
    if (wrongSource === undefined) wrongSource = stable; else assert.deepEqual(stable, wrongSource, state);
    assert.ok(Array.isArray(result.findings) && result.findings.length > 0);
  }
  yield* Effect.sync(() => text(consumer, 'test/sample.ts', markedSource));
  yield* success(consumer, cli, ['test', 'discover']);
})).pipe(Effect.provide(OwnedProcessLive))));
