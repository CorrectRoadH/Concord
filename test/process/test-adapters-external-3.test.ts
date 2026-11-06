import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { sourceCli, assert, existsSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, join, tmpdir, fileURLToPath, test, Effect, Schema, OwnedProcessLive, hasSuccessfulOwnedProcessResult, runOwnedProcess, ProjectSchema, renderTypeScriptConfig, parseTypeScriptConfig, type TestAdapter, LocalRepository, closeRepositoryCache, withPersistentCache, prepareSourceConsumer, sourceRoot, text, scratch, command, requireCommand, parse, CaseList, Receipt, setup, prepare, configure, call, success, idFor, environment, builtin } from '../support/test-adapters-consumer-fixture.ts';


import { externalCase } from '../support/external-adapter-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name external-adapter-boundaries-3
test('external adapter preserves selection and observes red to green input changes (C7-C11)', { skip: process.platform !== 'linux' && 'Native report directory-handle traversal is not verified on this platform' }, () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const { consumer, cli, id } = yield* externalCase();
  yield* Effect.sync(() => { text(consumer, 'mode.txt', 'red'); text(consumer, 'fixture.txt', 'original'); });
  const red = Schema.decodeUnknownSync(Receipt)(JSON.parse((yield* call(consumer, cli, ['test', 'run', id, '--require-native'])).stdout)); assert.equal(red.commandOutcome, 'red');
  yield* Effect.sync(() => text(consumer, 'mode.txt', 'green'));
  const green = Schema.decodeUnknownSync(Receipt)(JSON.parse((yield* success(consumer, cli, ['test', 'run', id, '--require-native'])).stdout));
  assert.notEqual(red.definitionDigest, green.definitionDigest); assert.deepEqual(red.requested, green.requested); assert.ok(green.gaps?.includes('ExternalInputUnknown'));
  yield* success(consumer, cli, ['cache', 'clear']);
  assert.equal(yield* idFor(consumer, cli), id);
})).pipe(Effect.provide(OwnedProcessLive), Effect.provideService(RuntimeEnvironment, makeRuntimeEnvironment(process.cwd(), process.env)))));
