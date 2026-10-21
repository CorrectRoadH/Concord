import assert from 'node:assert/strict';
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { ProjectSchema, digest, type Repository } from '../dist/shared.js';
import { parseTestDeclarations } from '../dist/annotations.js';
import { bindNative } from '../dist/test-adapter-binding.js';
import { ManifestSchema, PlanSchema, nativeVerdict, protocolDecode, protocolJson, type NativeManifest, type ProcessStatus } from '../dist/test-adapter-protocol.js';
import { readReports } from '../dist/test-adapter-reports.js';
import { TestAdapterSchema } from '../dist/test-adapter-config.js';

const caps = { realCollection: true, leaf: true, parameterGroups: true, exactSelection: true, perItemReport: true, range: true, rangeTrivia: true, tags: true, skipVisibility: true };
const config = { format: 'concord.project/v1', projectId: 'fixture', testRoots: ['test'], runner: { kind: 'node-test', sourceFiles: [], timeoutMs: 1000 } };
const adapter = { id: 'fixture', include: ['test'], argv: ['node', 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], frameworkVersion: 'fixture/v1', lockFiles: [], envNames: ['PATH'] };
const source = '// @feature docs/feature/sample/README.md\n// @name named\nconst placeholder = true;\n';
const marker = parseTestDeclarations('test/sample.ts', source).cases[0]!;
const repo = { read: () => source } as unknown as Repository;
const manifest = (ranges = [{ startLine: 3, endLine: 3, sourceDigest: digest(source) }]): NativeManifest => protocolDecode(ManifestSchema, { cases: ranges.flatMap((range, index) => ['one', 'two'].map(id => ({ nativeId: `fixture:${index}:${id}`, file: marker.file, project: 'test', kind: 'leaf', group: `group-${index}`, range, selection: { opaqueId: id, capabilityVersion: 'v1' }, tags: {}, provenance: 'fixture' }))), capabilities: caps, completeness: { complete: true, gaps: [] } });
const status: ProcessStatus = { invocationId: 'one', exitCode: 0, signal: null, timedOut: false, cancelled: false, outputTruncated: false, cleanup: 'complete' };

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name adapter-configuration-c17
test('adapter config validates path segments, overlap and hard budgets (C17)', () => Effect.runPromise(Effect.sync(() => {
  assert.doesNotThrow(() => protocolDecode(ProjectSchema, { ...config, testAdapters: [adapter] }));
  for (const testAdapters of [[{ ...adapter, include: ['test/../escape'] }], [{ ...adapter, include: ['test/a'] }, { ...adapter, id: 'other', include: ['test/a/nested'] }], [{ ...adapter, include: ['test/ab'] }, { ...adapter, id: 'other', include: ['test/ab'] }], [{ ...adapter, wallTimeoutMs: 600001 }], [{ ...adapter, budgets: { cases: 100001 } }], [{ ...adapter, builtin: 'go' }]]) assert.throws(() => protocolDecode(ProjectSchema, { ...config, testAdapters }));
  assert.doesNotThrow(() => protocolDecode(ProjectSchema, { ...config, testAdapters: [{ ...adapter, include: ['test/a'] }, { ...adapter, id: 'other', include: ['test/ab'] }] }));
})));

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name native-selector-v1-c15
test('native selectors preserve v1 identity and reject duplicate metadata (C7 C15)', () => Effect.runPromise(Effect.sync(() => {
  const before = parseTestDeclarations(marker.file, source).cases[0]!;
  const after = parseTestDeclarations(marker.file, source.replace('// @name named', '// @name named\n// @native fixture:one')).cases[0]!;
  assert.equal(before.id, after.id); assert.equal(after.native, 'fixture:one');
  assert.ok(parseTestDeclarations(marker.file, source.replace('// @name named', '// @native one\n// @native two')).findings.length);
  assert.equal(parseTestDeclarations(marker.file, '// @tag arbitrary\n').cases.length, 0);
  assert.equal(parseTestDeclarations(marker.file, 'const x = "// @native fake:one";\n').cases.length, 0);
})));

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name native-binding-c1-c8
test('range binding expands parameter groups, detects overlap and explicit conflict (C1 C2 C8)', () => Effect.runPromise(Effect.sync(() => {
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
  const commentMarker = parseTestDeclarations(marker.file, commentSource).cases[0]!;
  const commentManifest = { ...current, cases: current.cases.map(item => ({ ...item, range: { startLine: 3, endLine: 3, sourceDigest: digest(commentSource) } })) };
  assert.equal(bindNative({ read: () => commentSource } as unknown as Repository, commentMarker, commentManifest), undefined);
})));

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name adapter-protocol-invalid-c12-c16
test('protocol rejects duplicate keys, nonfinite values, excess fields and limits (C12 C16)', () => Effect.runPromise(Effect.sync(() => {
  for (const json of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"nested":{"a":1,"a":2}}', '{"a":1e999}', '[NaN]', '{"a":true} trailing']) assert.throws(() => protocolJson(json), { code: 'AdapterProtocolInvalid' });
  assert.deepEqual(protocolJson('{"a":{"b":1},"c":[{"b":2}]}'), { a: { b: 1 }, c: [{ b: 2 }] });
  assert.throws(() => protocolJson('{}', 1), { code: 'AdapterProtocolInvalid' });
  assert.throws(() => protocolDecode(PlanSchema, { invocations: [], planContext: {} }), { code: 'AdapterProtocolInvalid' });
  assert.throws(() => protocolDecode(ManifestSchema, { ...manifest(), extra: true }), { code: 'AdapterProtocolInvalid' });
})));

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name native-verdict-c3-c4-c5
test('native verdict rejects missing, duplicate, extra, skipped and infrastructure outcomes (C3 C4 C5 C12 C16)', () => Effect.runPromise(Effect.sync(() => {
  const passed = [{ nativeId: 'fixture:one', outcome: 'passed' as const, provenance: 'fixture' }];
  assert.equal(nativeVerdict(['fixture:one'], passed, [status], true), 'green');
  assert.equal(nativeVerdict(['fixture:one'], [{ ...passed[0]!, outcome: 'failed' }], [{ ...status, exitCode: 1 }], true), 'red');
  for (const results of [[], [...passed, ...passed], [...passed, { ...passed[0]!, nativeId: 'fixture:extra' }], [{ ...passed[0]!, outcome: 'skipped' as const }], [{ ...passed[0]!, outcome: 'todo' as const }], [{ ...passed[0]!, outcome: 'not-run' as const }]]) assert.equal(nativeVerdict(['fixture:one'], results, [status], true), 'invalid');
  for (const changed of [{ ...status, timedOut: true }, { ...status, cancelled: true }, { ...status, outputTruncated: true }, { ...status, cleanup: 'unknown' as const }, { ...status, signal: 'SIGTERM' }, { ...status, exitCode: null }]) assert.equal(nativeVerdict(['fixture:one'], passed, [changed], true), 'invalid');
  assert.equal(nativeVerdict([], [], [status], true), 'invalid');
})));

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name adapter-reports-c14
test('report ownership rejects path escape, symlinks, hardlinks, old files and budgets (C14)', { skip: process.platform !== 'linux' && 'Native report directory-handle traversal is not verified on this platform' }, () => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), 'concord-report-boundary-'));
  const decoded = protocolDecode(TestAdapterSchema, adapter);
  try {
    writeFileSync(join(root, 'new.json'), '{}');
    assert.equal(readReports(root, ['new.json'], decoded, { files: 0, bytes: 0 })[0]?.text, '{}');
    assert.throws(() => readReports(root, ['../outside'], decoded, { files: 0, bytes: 0 }), { code: 'ReportUnsafe' });
    assert.throws(() => readReports(root, ['new.json'], { ...decoded, budgets: { reportFileBytes: 1 } }, { files: 0, bytes: 0 }), { code: 'ReportUnsafe' });
    symlinkSync(join(root, 'new.json'), join(root, 'link.json'));
    assert.throws(() => readReports(root, ['new.json', 'link.json'], decoded, { files: 0, bytes: 0 }), { code: 'ReportUnsafe' });
    rmSync(join(root, 'link.json')); linkSync(join(root, 'new.json'), join(root, 'alias.json'));
    assert.throws(() => readReports(root, ['new.json', 'alias.json'], decoded, { files: 0, bytes: 0 }), { code: 'ReportUnsafe' });
    rmSync(join(root, 'alias.json')); writeFileSync(join(root, 'old.json'), '{}');
    assert.throws(() => readReports(root, ['new.json'], decoded, { files: 0, bytes: 0 }), { code: 'ReportUnsafe' });
    rmSync(join(root, 'old.json')); writeFileSync(join(root, 'new.json'), '<!DOCTYPE x><x/>');
    assert.throws(() => readReports(root, ['new.json'], decoded, { files: 0, bytes: 0 }), { code: 'ReportUnsafe' });
    mkdirSync(join(root, 'actual', 'invocation'), { recursive: true });
    writeFileSync(join(root, 'actual', 'invocation', 'result.json'), '{}');
    symlinkSync(join(root, 'actual'), join(root, 'alias'), 'dir');
    assert.throws(() => readReports(join(root, 'alias', 'invocation'), ['result.json'], decoded, { files: 0, bytes: 0 }), { code: 'ReportUnsafe' });
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
