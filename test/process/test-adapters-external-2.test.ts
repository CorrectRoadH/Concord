import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
// 跨进程保证：外部程序——adapter exchanges and split invocations produce a native CLI receipt.
import { assert, test, Effect, Schema, OwnedProcessLive, text, Receipt, call } from '../support/test-adapters-consumer-fixture.ts';
import { externalCase } from '../support/external-adapter-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name external-adapter-boundaries-2
test('external adapter runs green and split report invocations (C3 C12)', { skip: process.platform !== 'linux' && 'Native report directory-handle traversal is not verified on this platform' }, () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const { consumer, cli, id } = yield* externalCase();
  for (const mode of ['green', 'split']) {
    yield* Effect.sync(() => text(consumer, 'mode.txt', mode));
    const run = yield* call(consumer, cli, ['test', 'run', id, '--require-native']);
    const receipt = Schema.decodeUnknownSync(Receipt)(JSON.parse(run.stdout));
    assert.equal(receipt.commandOutcome, 'green', `${mode}: ${run.stderr}\n${run.stdout}`);
    assert.equal(receipt.requested?.length, 2);
    if (mode === 'split') assert.equal(receipt.commandExecutionCount, 2);
  }
})).pipe(Effect.provide(OwnedProcessLive), Effect.provide(RuntimeEnvironment.layer(makeRuntimeEnvironment(process.cwd(), process.env))))));
