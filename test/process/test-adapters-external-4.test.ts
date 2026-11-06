import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
// 跨进程保证：外部程序——adapter timeout, report path escape and source drift fail the CLI run.
import { assert, test, Effect, OwnedProcessLive, text, call } from '../support/test-adapters-consumer-fixture.ts';
import { externalCase } from '../support/external-adapter-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name external-adapter-boundaries-4
test('external adapter rejects timeouts, escaping reports and drifting inputs (C12-C16)', { skip: process.platform !== 'linux' && 'Native report directory-handle traversal is not verified on this platform' }, () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const { consumer, cli, id } = yield* externalCase();
  for (const mode of ['timeout', 'escape-report', 'drift', 'drift-config', 'drift-lock', 'drift-member']) {
    yield* Effect.sync(() => text(consumer, 'mode.txt', mode));
    const run = yield* call(consumer, cli, ['test', 'run', id, '--require-native']);
    assert.equal(run.exitCode, 1, mode); assert.match(run.stderr, /AdapterProtocolInvalid|ReportUnsafe|InputChanged/, mode);
  }
})).pipe(Effect.provide(OwnedProcessLive), Effect.provide(RuntimeEnvironment.layer(makeRuntimeEnvironment(process.cwd(), process.env))))));
