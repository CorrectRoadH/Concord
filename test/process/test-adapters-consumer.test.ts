import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { sourceCli, assert, existsSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, join, tmpdir, fileURLToPath, test, Effect, Schema, OwnedProcessLive, hasSuccessfulOwnedProcessResult, runOwnedProcess, ProjectSchema, renderTypeScriptConfig, parseTypeScriptConfig, type TestAdapter, LocalRepository, closeRepositoryCache, withPersistentCache, prepareSourceConsumer, sourceRoot, text, scratch, command, requireCommand, parse, CaseList, Receipt, setup, prepare, configure, call, success, idFor, environment, builtin } from '../support/test-adapters-consumer-fixture.ts';


import { externalCase } from '../support/external-adapter-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name packed-external-adapter-boundaries
test('packed external adapter preserves static relations and rejects dishonest protocol/report outcomes (C1-C5 C7-C16)', { skip: process.platform !== 'linux' && 'Native report directory-handle traversal is not verified on this platform' }, () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const { consumer, cli, id } = yield* externalCase();
  yield* Effect.addFinalizer(() => call(consumer, cli, ['server', 'stop']).pipe(Effect.tap(result => Effect.sync(() => assert.equal(result.exitCode, 0, result.stderr))), Effect.asVoid, Effect.orDie));
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
    if (state === 'corrupt') { yield* success(consumer, cli, ['server', 'stop']); yield* Effect.sync(corruptObservation); }
    if (state === 'clear') yield* success(consumer, cli, ['cache', 'clear']);
    const checked = parse((yield* success(consumer, cli, ['check'])).stdout);
    for (const field of ['ok', 'complete', 'findings']) assert.deepEqual(checked[field], before[field], state);
    assert.deepEqual(Schema.decodeUnknownSync(CaseList)(JSON.parse((yield* success(consumer, cli, ['test', 'list'])).stdout)).cases, coldCases, state);
  }
})).pipe(Effect.provide(OwnedProcessLive), Effect.provide(RuntimeEnvironment.layer(makeRuntimeEnvironment(process.cwd(), process.env))))));
