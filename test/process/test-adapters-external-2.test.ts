// 跨进程保证：外部程序——真实 adapter 的多个收集调用保留原生身份和元数据。
import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { assert, test, Effect, Schema, OwnedProcessLive, text, call } from '../support/test-adapters-consumer-fixture.ts';
import { externalCase } from '../support/external-adapter-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/collect-native-tests.md#discover
// @name external-adapter-collection-invocations
test('external adapter collects through one or multiple real invocations', { skip: process.platform !== 'linux' && 'Native report directory-handle traversal is not verified on this platform' }, () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const { consumer, cli } = yield* externalCase();
  for (const mode of ['green', 'split']) {
    yield* Effect.sync(() => text(consumer, 'mode.txt', mode));
    const result = yield* call(consumer, cli, ['test', 'discover', 'test/sample.ts']);
    assert.equal(result.exitCode, 0, `${mode}: ${result.stderr}\n${result.stdout}`);
    const manifest = Schema.decodeUnknownSync(Schema.Struct({ observations: Schema.Array(Schema.Struct({ observation: Schema.Struct({ current: Schema.Boolean, complete: Schema.Boolean, gaps: Schema.Array(Schema.String), value: Schema.Struct({ cases: Schema.Array(Schema.Struct({ nativeId: Schema.String, group: Schema.String, tags: Schema.Record(Schema.String, Schema.String) })) }) }) })) }))(JSON.parse(result.stdout)).observations[0]!.observation;
    assert.equal(manifest.current, true);
    assert.equal(manifest.complete, false);
    assert.ok(manifest.gaps.includes('ExternalInputUnknown'));
    assert.deepEqual(manifest.value.cases.map(item => item.nativeId), ['fake:binary-a:one', 'fake:binary-b:two']);
    for (const item of manifest.value.cases) {
      assert.equal(item.group, 'parameters');
      assert.deepEqual(item.tags, { tag: 'not-a-relation' });
    }
  }
})).pipe(Effect.provide(OwnedProcessLive), Effect.provide(RuntimeEnvironment.layer(makeRuntimeEnvironment(process.cwd(), process.env))))));
