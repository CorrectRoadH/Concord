import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { ADAPTER_FORMAT, ReportSchema, nativeVerdict, protocolDecode, protocolJson, type ProcessStatus } from '../../src/model/index.ts';

const capabilities = { realCollection: true, leaf: true, parameterGroups: true, exactSelection: true, perItemReport: true, range: true, rangeTrivia: true, tags: true, skipVisibility: true };
const requested = ['fake:binary-a:one', 'fake:binary-b:two'];
const status: ProcessStatus = { invocationId: 'run', exitCode: 0, signal: null, timedOut: false, cancelled: false, outputTruncated: false, cleanup: 'complete' };

for (const mode of ['green', 'missing', 'duplicate', 'extra'] as const) {
  // @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md#run
  test(`external report ${mode} preserves the requested two-item assignment`, () => Effect.runPromise(Effect.sync(() => {
    const ids = [...requested];
    if (mode === 'missing') ids.pop();
    if (mode === 'duplicate') ids.push(ids[0]!);
    if (mode === 'extra') ids.push('fake:extra');
    const report = protocolDecode(ReportSchema, protocolJson(JSON.stringify({
      observed: ids.map(nativeId => ({ nativeId, outcome: 'passed', provenance: 'fixture/v1' })),
      capabilities, completeness: { complete: true, gaps: [] },
    })));
    assert.deepEqual(report.observed.map(item => item.nativeId), ids);
    assert.equal(requested.length, 2);
    assert.equal(nativeVerdict(requested, report.observed, [status], report.completeness.complete, [{ invocationId: status.invocationId, requested }]), mode === 'green' ? 'green' : 'invalid', mode);
  })));
}

for (const mode of ['duplicate-key', 'nonfinite'] as const) {
  // @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md#约束
  test(`external response rejects ${mode} before Schema decoding`, () => Effect.runPromise(Effect.sync(() => {
    const response = JSON.stringify({ format: ADAPTER_FORMAT, op: 'collect-plan', requestId: 'request', planId: 'plan', inputs: `sha256:${'1'.repeat(64)}`, payload: { invocations: [{ invocationId: 'collect', argv: ['node', 'adapter.ts', 'invoke', 'collect'], cwd: '.', envNames: ['PATH'], reports: [] }], planContext: { files: ['test/sample.ts'] } } });
    assert.doesNotThrow(() => protocolJson(response));
    const invalid = mode === 'duplicate-key'
      ? response.replace('"op":', '"op":"collect-plan","op":')
      : response.replace('"payload":', '"nonfinite":1e999,"payload":');
    assert.throws(() => protocolJson(invalid), { code: 'AdapterProtocolInvalid' }, mode);
  })));
}
