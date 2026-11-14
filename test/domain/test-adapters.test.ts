import { runApplication } from '../support/repository.ts';
import assert from 'node:assert/strict';
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { ProjectSchema, digest, type Repository } from "../../src/model/index.ts";
import { parseTestDeclarations } from "../../src/domain/tests/index.ts";
import { bindNative, builtinCollectParse, nativeBindings } from "../../src/domain/tests/index.ts";
import { ManifestSchema, test_adapter_protocol_PlanSchema as PlanSchema, protocolDecode, protocolJson, type NativeManifest } from "../../src/model/index.ts";
import { readReports } from "../../src/domain/tests/index.ts";
import { TestAdapterSchema } from "../../src/model/index.ts";

const caps = { realCollection: true, leaf: true, parameterGroups: true, range: true, rangeTrivia: true, tags: true };
const config = { testRoots: ['test'] };
const adapter = { id: 'fixture', include: ['test'], argv: ['node', 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], frameworkVersion: 'fixture/v1', lockFiles: [], envNames: ['PATH'] };
const source = '// @feature docs/feature/sample/README.md\n// @name named\nconst placeholder = true;\n';
const marker = (await parseTestDeclarations('test/sample.ts', source)).cases[0]!;
const repo = { read: () => source } as unknown as Repository;
const manifest = (ranges = [{ startLine: 3, endLine: 3, sourceDigest: digest(source) }]): NativeManifest => protocolDecode(ManifestSchema, { cases: ranges.flatMap((range, index) => ['one', 'two'].map(id => ({ nativeId: `fixture:${index}:${id}`, file: marker.file, project: 'test', kind: 'leaf', group: `group-${index}`, range, tags: {}, provenance: 'fixture' }))), capabilities: caps, completeness: { complete: true, gaps: [] } });

// @use-case docs/feature/local-sdlc/use-case/collect-native-tests.md
// @name adapter-configuration-c17
test('adapter config validates path segments, overlap and hard budgets (C17)', () => Effect.runPromise(Effect.sync(() => {
  assert.doesNotThrow(() => protocolDecode(ProjectSchema, { ...config, testAdapters: [adapter] }));
  for (const testAdapters of [[{ ...adapter, include: ['test/../escape'] }], [{ ...adapter, include: ['test/a'] }, { ...adapter, id: 'other', include: ['test/a/nested'] }], [{ ...adapter, include: ['test/ab'] }, { ...adapter, id: 'other', include: ['test/ab'] }], [{ ...adapter, wallTimeoutMs: 7200001 }], [{ ...adapter, budgets: { cases: 100001 } }], [{ ...adapter, builtin: 'go' }]]) assert.throws(() => protocolDecode(ProjectSchema, { ...config, testAdapters }));
  assert.doesNotThrow(() => protocolDecode(ProjectSchema, { ...config, testAdapters: [{ ...adapter, include: ['test/a'] }, { ...adapter, id: 'other', include: ['test/ab'] }] }));
})));

// @use-case docs/feature/local-sdlc/use-case/collect-native-tests.md
// @name native-selector-v1-c15
test('native selectors preserve v1 identity and reject duplicate metadata (C7 C15)', () => Effect.runPromise(Effect.tryPromise(async () => {
  const before = (await parseTestDeclarations(marker.file, source)).cases[0]!;
  const after = (await parseTestDeclarations(marker.file, source.replace('// @name named', '// @name named\n// @native fixture:one'))).cases[0]!;
  assert.equal(before.id, after.id); assert.equal(after.native, 'fixture:one');
  assert.ok((await parseTestDeclarations(marker.file, source.replace('// @name named', '// @native one\n// @native two'))).findings.length);
  assert.equal((await parseTestDeclarations(marker.file, '// @tag arbitrary\n')).cases.length, 0);
  assert.equal((await parseTestDeclarations(marker.file, 'const x = "// @native fake:one";\n')).cases.length, 0);
})));

// @use-case docs/feature/local-sdlc/use-case/collect-native-tests.md
// @name native-binding-c1-c8
test('range binding expands parameter groups, detects overlap and explicit conflict (C1 C2 C8)', () => Effect.runPromise(Effect.tryPromise(async () => {
  const current = manifest();
  assert.deepEqual(bindNative(repo, marker, current), ['fixture:0:one', 'fixture:0:two']);
  assert.deepEqual(bindNative(repo, { ...marker, native: 'fixture:0:one' }, current), ['fixture:0:one', 'fixture:0:two']);
  assert.throws(() => bindNative(repo, marker, manifest([{ startLine: 3, endLine: 3, sourceDigest: digest(source) }, { startLine: 3, endLine: 3, sourceDigest: digest(source) }])), { code: 'AmbiguousNativeBinding' });
  const noRange = { ...current, cases: current.cases.map(({ range, ...item }) => item), capabilities: { ...caps, range: false } };
  assert.equal(bindNative(repo, marker, noRange), undefined);
  assert.deepEqual(bindNative(repo, { ...marker, native: 'fixture:0:one' }, noRange), ['fixture:0:one', 'fixture:0:two']);
  const another = { ...current.cases[0]!, nativeId: 'fixture:outside', group: 'outside', range: undefined };
  assert.throws(() => bindNative(repo, { ...marker, native: another.nativeId }, { ...current, cases: [...current.cases, another] }), { code: 'NativeSelectorConflict' });
  const commentSource = '// @feature docs/feature/sample/README.md\n// ordinary comment outside the marker metadata\nconst test = true;\n';
  const commentMarker = (await parseTestDeclarations(marker.file, commentSource)).cases[0]!;
  const commentManifest = { ...current, cases: current.cases.map(item => ({ ...item, range: { startLine: 3, endLine: 3, sourceDigest: digest(commentSource) } })) };
  assert.equal(bindNative({ read: () => commentSource } as unknown as Repository, commentMarker, commentManifest), undefined);
})));

// @use-case docs/feature/local-sdlc/use-case/collect-native-tests.md
// @name adapter-protocol-invalid-c12-c16
test('protocol rejects duplicate keys, nonfinite values, excess fields and limits (C12 C16)', () => Effect.runPromise(Effect.sync(() => {
  for (const json of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"nested":{"a":1,"a":2}}', '{"a":1e999}', '[NaN]', '{"a":true} trailing']) assert.throws(() => protocolJson(json), { code: 'AdapterProtocolInvalid' });
  assert.deepEqual(protocolJson('{"a":{"b":1},"c":[{"b":2}]}'), { a: { b: 1 }, c: [{ b: 2 }] });
  assert.throws(() => protocolJson('{}', 1), { code: 'AdapterProtocolInvalid' });
  assert.throws(() => protocolDecode(PlanSchema, { invocations: [], planContext: {} }), { code: 'AdapterProtocolInvalid' });
  assert.throws(() => protocolDecode(ManifestSchema, { ...manifest(), extra: true }), { code: 'AdapterProtocolInvalid' });
})));

// @use-case docs/feature/local-sdlc/use-case/collect-native-tests.md
// @name adapter-reports-c14
test('report ownership rejects path escape, symlinks, hardlinks, old files and budgets (C14)', { skip: process.platform !== 'linux' && 'Native report directory-handle traversal is not verified on this platform' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-report-boundary-'));
  const decoded = protocolDecode(TestAdapterSchema, adapter);
  try {
    writeFileSync(join(root, 'new.json'), '{}');
    assert.equal((await runApplication(readReports(root, ['new.json'], decoded, { files: 0, bytes: 0 })))[0]?.text, '{}');
    await assert.rejects(runApplication(readReports(root, ['../outside'], decoded, { files: 0, bytes: 0 })), { code: 'ReportUnsafe' });
    await assert.rejects(runApplication(readReports(root, ['new.json'], { ...decoded, budgets: { reportFileBytes: 1 } }, { files: 0, bytes: 0 })), { code: 'ReportUnsafe' });
    symlinkSync(join(root, 'new.json'), join(root, 'link.json'));
    await assert.rejects(runApplication(readReports(root, ['new.json', 'link.json'], decoded, { files: 0, bytes: 0 })), { code: 'ReportUnsafe' });
    rmSync(join(root, 'link.json')); linkSync(join(root, 'new.json'), join(root, 'alias.json'));
    await assert.rejects(runApplication(readReports(root, ['new.json', 'alias.json'], decoded, { files: 0, bytes: 0 })), { code: 'ReportUnsafe' });
    rmSync(join(root, 'alias.json')); writeFileSync(join(root, 'old.json'), '{}');
    await assert.rejects((runApplication(readReports(root, ['new.json'], decoded, { files: 0, bytes: 0 }))), { code: 'ReportUnsafe' });
    rmSync(join(root, 'old.json')); writeFileSync(join(root, 'new.json'), '<!DOCTYPE x><x/>');
    await assert.rejects((runApplication(readReports(root, ['new.json'], decoded, { files: 0, bytes: 0 }))), { code: 'ReportUnsafe' });
    mkdirSync(join(root, 'actual', 'invocation'), { recursive: true });
    writeFileSync(join(root, 'actual', 'invocation', 'result.json'), '{}');
    symlinkSync(join(root, 'actual'), join(root, 'alias'), 'dir');
    await assert.rejects(runApplication(readReports(join(root, 'alias', 'invocation'), ['result.json'], decoded, { files: 0, bytes: 0 })), { code: 'ReportUnsafe' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-sdlc/cli.md#具体用例绑定输出
test('native bindings expose only current unambiguous groups and retain labels and capability gaps', () => {
  const current = manifest();
  const viewRepo = { ...repo, config: { testAdapters: [adapter] } } as unknown as Repository;
  const observed = (value: NativeManifest, current = true, gaps: readonly string[] = []) => [{ adapterId: adapter.id, observation: { value, inputs: digest(source), complete: gaps.length === 0, gaps, current, observedAt: '2026-11-13T00:00:00.000Z' } }];
  const missing = nativeBindings(viewRepo, [marker], [])[0]!;
  assert.deepEqual(missing, { testId: marker.id, current: false, complete: false, nativeCases: [], gaps: ['NativeObservationUnavailable'] });
  const stale = nativeBindings(viewRepo, [marker], observed(current, false))[0]!;
  assert.equal(stale.current, false);
  assert.equal(stale.complete, false);
  assert.deepEqual(stale.nativeCases, []);
  assert.ok(stale.gaps.includes('NativeObservationStale'));
  const labeled = { ...current, cases: current.cases.map(item => ({ ...item, tags: { owner: 'docs', feature: marker.contract } })) };
  const bound = nativeBindings(viewRepo, [marker], observed(labeled))[0]!;
  assert.equal(bound.current, true);
  assert.equal(bound.complete, true);
  assert.deepEqual(bound.nativeCases.map(item => item.nativeId), ['fixture:0:one', 'fixture:0:two']);
  assert.deepEqual(bound.nativeCases[0], { nativeId: 'fixture:0:one', project: 'test', file: marker.file, kind: 'leaf', group: 'group-0', range: current.cases[0]!.range, tags: { owner: 'docs', feature: marker.contract } });
  assert.ok(!('provenance' in bound.nativeCases[0]!));
  const partial = nativeBindings(viewRepo, [marker], observed(labeled, true, ['ExternalInputUnknown']))[0]!;
  assert.equal(partial.complete, false);
  assert.equal(partial.nativeCases.length, 2);
  assert.ok(partial.gaps.includes('ExternalInputUnknown'));
  const noRange = { ...labeled, cases: labeled.cases.map(({ range: _range, ...item }) => item), capabilities: { ...caps, range: false } };
  const unknown = nativeBindings(viewRepo, [marker], observed(noRange))[0]!;
  assert.deepEqual(unknown.nativeCases, [], 'labels and marker names cannot authorize binding');
  assert.ok(unknown.gaps.includes('NativeBindingUnavailable'));
  const explicit = nativeBindings(viewRepo, [{ ...marker, native: 'fixture:0:one' }], observed(noRange))[0]!;
  assert.equal(explicit.nativeCases.length, 2);
  const invalid = nativeBindings(viewRepo, [{ ...marker, native: 'fixture:missing' }], observed(current))[0]!;
  assert.deepEqual(invalid.nativeCases, []);
  assert.ok(invalid.gaps.includes('NativeBindingUnavailable'));
  const ambiguous = manifest([{ startLine: 3, endLine: 3, sourceDigest: digest(source) }, { startLine: 3, endLine: 3, sourceDigest: digest(source) }]);
  const collision = nativeBindings(viewRepo, [marker], observed(ambiguous))[0]!;
  assert.deepEqual(collision.nativeCases, []);
  assert.ok(collision.gaps.includes('AmbiguousNativeBinding'));
  const outside = { ...current.cases[0]!, nativeId: 'fixture:outside', group: 'outside', range: undefined };
  const conflict = nativeBindings(viewRepo, [{ ...marker, native: outside.nativeId }], observed({ ...current, cases: [...current.cases, outside] }))[0]!;
  assert.deepEqual(conflict.nativeCases, []);
  assert.ok(conflict.gaps.includes('NativeSelectorConflict'));
  assert.deepEqual(nativeBindings(viewRepo, [], observed(current)), []);
});

// @use-case docs/feature/local-sdlc/use-case/collect-native-tests.md#discover
test('builtin collection preserves Vitest labels and reports unsupported Node collection honestly', async () => {
  const context = { root: '/fixture', runId: 'observation', planId: 'plan', inputs: digest(source), reportDirectory: '/reports' };
  const status = { invocationId: 'collect', exitCode: 0, signal: null, timedOut: false, cancelled: false, outputTruncated: false, cleanup: 'complete' as const };
  const { argv: _argv, ...base } = protocolDecode(TestAdapterSchema, adapter);
  const text = JSON.stringify([{ name: 'same test name', file: '/fixture/test/sample.ts', project: 'project-a', tags: { slow: 'true', owner: 'docs' } }, { name: 'same test name', file: '/fixture/test/sample.ts', project: 'project-b', tags: {} }]);
  const captures = [{ status, stdout: '', stderr: '', reports: [{ path: 'manifest.json', text, digest: digest(text) }] }];
  const vitest = await runApplication(builtinCollectParse({ ...base, builtin: 'vitest' }, context, [marker.file], captures));
  assert.equal(vitest.cases.length, 2);
  assert.notEqual(vitest.cases[0]!.nativeId, vitest.cases[1]!.nativeId);
  assert.deepEqual(vitest.cases[0]!.tags, { slow: 'true', owner: 'docs' });
  assert.equal(vitest.capabilities.tags, true);
  assert.equal(vitest.completeness.complete, false);
  assert.ok(vitest.completeness.gaps.includes('RangeUnavailable'));
  assert.ok(!vitest.completeness.gaps.includes('TagsUnavailable'));
  const node = await runApplication(builtinCollectParse({ ...base, builtin: 'node-test' }, context, [marker.file], [{ status, stdout: 'v26.0.0', stderr: '', reports: [] }]));
  assert.deepEqual(node.cases, []);
  assert.equal(node.capabilities.realCollection, false);
  assert.ok(node.completeness.gaps.includes('NodeCollectionUnsupported'));
});
