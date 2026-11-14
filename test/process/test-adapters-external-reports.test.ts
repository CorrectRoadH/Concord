// 跨进程保证：外部程序——真实 adapter 的收集产物和协议错误不能发布为成功清单。
import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { assert, test, Effect, OwnedProcessLive, text, call } from '../support/test-adapters-consumer-fixture.ts';
import { externalCase } from '../support/external-adapter-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/collect-native-tests.md#discover
// @name external-adapter-collection-artifacts
test('external adapter rejects unsafe collection artifacts and invalid collection responses', { skip: process.platform !== 'linux' && 'Native report directory-handle traversal is not verified on this platform' }, () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const { consumer, cli } = yield* externalCase();
  for (const mode of ['parser-failed', 'symlink', 'unexpected-report', 'large-report', 'xml-report', 'duplicate-key', 'nonfinite', 'wrong-echo', 'extra-envelope', 'collect-failed']) {
    yield* Effect.sync(() => text(consumer, 'mode.txt', mode));
    const result = yield* call(consumer, cli, ['test', 'discover', 'test/sample.ts']);
    assert.equal(result.exitCode, 1, `${mode}: ${result.stderr}\n${result.stdout}`);
    assert.match(result.stderr, /AdapterProtocolInvalid|ReportUnsafe|CollectFailed/u, mode);
  }
})).pipe(Effect.provide(OwnedProcessLive), Effect.provideService(RuntimeEnvironment, makeRuntimeEnvironment(process.cwd(), process.env)))));
