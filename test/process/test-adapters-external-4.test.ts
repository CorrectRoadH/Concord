import { packageBin, assert, existsSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, join, tmpdir, fileURLToPath, test, Effect, Schema, OwnedProcessLive, hasSuccessfulOwnedProcessResult, runOwnedProcess, ProjectSchema, renderTypeScriptConfig, parseTypeScriptConfig, type TestAdapter, LocalRepository, closeRepositoryCache, withPersistentCache, prepareSourceConsumer, sourceConcord, sourceRoot, text, scratch, command, requireCommand, parse, CaseList, Receipt, setup, prepare, configure, call, success, idFor, environment, builtin } from '../support/test-adapters-consumer-fixture.ts';


import { externalCase } from '../support/external-adapter-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name external-adapter-boundaries-4
test('external adapter rejects every invalid protocol and drifting input scenario (C12-C16)', { skip: process.platform !== 'linux' && 'Native report directory-handle traversal is not verified on this platform' }, () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const { consumer, cli, id } = yield* externalCase();
  for (const mode of ['wrong-echo', 'extra-envelope', 'duplicate-key', 'nonfinite', 'timeout', 'escape-report', 'drift', 'drift-config', 'drift-lock', 'drift-member']) {
    yield* Effect.sync(() => text(consumer, 'mode.txt', mode));
    const run = yield* call(consumer, cli, ['test', 'run', id, '--require-native']);
    assert.equal(run.exitCode, 1, mode); assert.match(run.stderr, /AdapterProtocolInvalid|ReportUnsafe|InputChanged/, mode);
  }
})).pipe(Effect.provide(OwnedProcessLive))));
