import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { ADAPTER_FORMAT, ManifestSchema, NativeBindingViewSchema, RequestSchema, protocolDecode, protocolJson } from '../../src/model/index.ts';

for (const mode of ['duplicate-key', 'nonfinite'] as const) {
  // @use-case docs/feature/local-sdlc/use-case/collect-native-tests.md#discover
  test(`external response rejects ${mode} before Schema decoding`, () => Effect.runPromise(Effect.sync(() => {
    const response = JSON.stringify({ format: ADAPTER_FORMAT, op: 'collect-plan', requestId: 'request', planId: 'plan', inputs: `sha256:${'1'.repeat(64)}`, payload: { invocations: [{ invocationId: 'collect', argv: ['node', 'adapter.ts', 'invoke', 'collect'], cwd: '.', envNames: ['PATH'], reports: [] }], planContext: { files: ['test/sample.ts'] } } });
    assert.doesNotThrow(() => protocolJson(response));
    const invalid = mode === 'duplicate-key'
      ? response.replace('"op":', '"op":"collect-plan","op":')
      : response.replace('"payload":', '"nonfinite":1e999,"payload":');
    assert.throws(() => protocolJson(invalid), { code: 'AdapterProtocolInvalid' }, mode);
  })));
}

// @feature docs/feature/local-sdlc/cli.md#adapter-协议
test('collection protocol retains native metadata and rejects unsupported fields at each boundary', () => {
  const inputs = `sha256:${'1'.repeat(64)}`;
  const capabilities = { realCollection: true, leaf: true, parameterGroups: true, range: true, rangeTrivia: true, tags: true };
  const item = { nativeId: 'fixture:one', project: 'fixture', file: 'test/sample.ts', kind: 'leaf', group: 'parameters', range: { startLine: 1, endLine: 4, sourceDigest: inputs }, tags: { owner: 'docs' }, provenance: 'fixture/v1' };
  const manifest = { cases: [item], capabilities, completeness: { complete: true, gaps: [] } };
  assert.deepEqual(protocolDecode(ManifestSchema, manifest), manifest);
  assert.throws(() => protocolDecode(ManifestSchema, { ...manifest, cases: [{ ...item, unexpected: true }] }), { code: 'AdapterProtocolInvalid' });
  assert.throws(() => protocolDecode(ManifestSchema, { ...manifest, capabilities: { ...capabilities, unexpected: true } }), { code: 'AdapterProtocolInvalid' });
  const request = { format: ADAPTER_FORMAT, op: 'collect-plan', requestId: 'one', context: { root: '/fixture', runId: 'observation', planId: 'plan', inputs, reportDirectory: '/reports' }, payload: {} };
  assert.doesNotThrow(() => protocolDecode(RequestSchema, request));
  assert.throws(() => protocolDecode(RequestSchema, { ...request, op: 'unsupported' }), { code: 'AdapterProtocolInvalid' });
});

// @feature docs/feature/local-sdlc/cli.md#具体用例绑定输出
test('binding projection schema retains declared metadata and rejects unrelated native fields', () => {
  const item = { nativeId: 'fixture:one', project: 'fixture', file: 'test/sample.ts', kind: 'leaf', group: 'parameters', range: { startLine: 1, endLine: 4, sourceDigest: `sha256:${'1'.repeat(64)}` }, tags: { owner: 'docs' } };
  const binding = { testId: 'marker', current: true, complete: true, nativeCases: [item], gaps: [] };
  assert.deepEqual(protocolDecode(NativeBindingViewSchema, binding), binding);
  assert.throws(() => protocolDecode(NativeBindingViewSchema, { ...binding, nativeCases: [{ ...item, provenance: 'fixture/v1' }] }), { code: 'AdapterProtocolInvalid' });
  assert.throws(() => protocolDecode(NativeBindingViewSchema, { ...binding, nativeCases: [{ ...item, range: { ...item.range, endLine: 0 } }] }), { code: 'AdapterProtocolInvalid' });
});
