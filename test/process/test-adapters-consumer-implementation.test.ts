import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { sourceCli, assert, existsSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, join, tmpdir, fileURLToPath, test, Effect, Schema, OwnedProcessLive, hasSuccessfulOwnedProcessResult, runOwnedProcess, ProjectSchema, renderTypeScriptConfig, parseTypeScriptConfig, type TestAdapter, LocalRepository, closeRepositoryCache, withPersistentCache, prepareSourceConsumer, sourceRoot, text, scratch, command, requireCommand, parse, CaseList, Receipt, setup, prepare, configure, call, success, idFor, environment, builtin } from '../support/test-adapters-consumer-fixture.ts';


import { externalCase } from '../support/external-adapter-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name packed-external-adapter-implementation-boundaries
test('external adapter implementation changes invalidate observations until rediscovery', { skip: process.platform !== 'linux' && 'Native report directory-handle traversal is not verified on this platform' }, () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const { consumer, cli, id } = yield* externalCase();
  yield* Effect.addFinalizer(() => call(consumer, cli, ['server', 'stop']).pipe(Effect.tap(result => Effect.sync(() => assert.equal(result.exitCode, 0, result.stderr))), Effect.asVoid, Effect.orDie));
  yield* success(consumer, cli, ['test', 'discover']);
  const observationState = (source: string) => Schema.decodeUnknownSync(Schema.Struct({ observations: Schema.Array(Schema.Struct({ observation: Schema.Struct({ current: Schema.Boolean, inputs: Schema.String }) })) }))(JSON.parse(source)).observations[0]!.observation;
  const scriptBefore = observationState((yield* success(consumer, cli, ['test', 'list'])).stdout);
  yield* Effect.sync(() => text(consumer, 'adapter.ts', readFileSync(join(consumer, 'adapter.ts'), 'utf8') + '\n// implementation changed\n'));
  assert.equal(observationState((yield* success(consumer, cli, ['test', 'list'])).stdout).current, false);
  yield* success(consumer, cli, ['test', 'discover']);
  const scriptAfter = observationState((yield* success(consumer, cli, ['test', 'list'])).stdout);
  assert.equal(scriptAfter.current, true); assert.notEqual(scriptBefore.inputs, scriptAfter.inputs);
})).pipe(Effect.provide(OwnedProcessLive), Effect.provideService(RuntimeEnvironment, makeRuntimeEnvironment(process.cwd(), process.env)))));
