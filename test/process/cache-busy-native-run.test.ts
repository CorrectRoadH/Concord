// 跨进程保证：原生模块与句柄——真实工作区服务持有数据库时，独立命令的公开 CLI 收集仍完成并保留原生身份。
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Schema } from 'effect';
import { command, fixture, record, stop } from '../support/workspace-server-fixture.ts';

// @feature docs/feature/local-data-engine/architecture.md#句柄与打开模式
test('native collection completes while the workspace service owns the persistent cache', { timeout: 60_000 }, async () => {
  const root = (await fixture());
  const source = fileURLToPath(new URL('../..', import.meta.url));
  try {
    mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'test/sample.ts'), '// @feature docs/feature/reader/README.md\n// @name cache-busy-native\n// @native fixture:cache-busy-native\n');
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    symlinkSync(join(source, 'node_modules'), join(root, 'node_modules'), 'dir');
    // The external fixture collects through stdout, so this ownership guarantee
    // does not depend on platform-specific report-file traversal support.
    writeFileSync(join(root, 'adapter.ts'), `
import { readFileSync } from 'node:fs';
import { Effect, Schema } from 'effect';
const Request = Schema.Struct({ format: Schema.Literal('concord.test-adapter/v1'), op: Schema.Literals(['collect-plan', 'collect-parse']), requestId: Schema.String, context: Schema.Struct({ root: Schema.String, runId: Schema.String, planId: Schema.String, inputs: Schema.String, reportDirectory: Schema.String }), payload: Schema.Unknown });
await Effect.runPromise(Effect.sync(() => {
  if (process.argv[2] === 'collect') { process.stdout.write('fixture:cache-busy-native\\n'); return; }
  const request = Schema.decodeUnknownSync(Schema.fromJsonString(Request))(readFileSync(0, 'utf8'));
  let payload: unknown;
  if (request.op === 'collect-plan') {
    const input = Schema.decodeUnknownSync(Schema.Struct({ files: Schema.NonEmptyArray(Schema.String) }))(request.payload);
    payload = { invocations: [{ invocationId: 'collect', argv: [process.execPath, 'adapter.ts', 'collect'], cwd: '.', envNames: [], reports: [] }], planContext: { file: input.files[0] } };
  } else {
    const input = Schema.decodeUnknownSync(Schema.Struct({ planContext: Schema.Struct({ file: Schema.String }), captures: Schema.NonEmptyArray(Schema.Struct({ stdout: Schema.String })) }))(request.payload);
    payload = { cases: [{ nativeId: input.captures[0].stdout.trim(), project: 'fixture', file: input.planContext.file, kind: 'leaf', tags: {}, provenance: 'fixture/v1' }], capabilities: { realCollection: true, leaf: true, parameterGroups: false, range: false, rangeTrivia: false, tags: false }, completeness: { complete: true, gaps: [] } };
  }
  process.stdout.write(JSON.stringify({ format: request.format, op: request.op, requestId: request.requestId, planId: request.context.planId, inputs: request.context.inputs, payload }) + '\\n');
}));
`);
    writeFileSync(join(root, 'concord.config.ts'), `export default ${JSON.stringify({ testRoots: ['test'], testAdapters: [{ id: 'fixture', include: ['test'], argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], lockFiles: [], frameworkVersion: 'fixture/v1', envNames: ['PATH'] }] })};\n`);
    const started = await command(root, ['server', 'start']);
    assert.equal(started.status, 0, started.stderr);
    const pid = record(root).pid;
    const listed = await command(root, ['test', 'list']);
    assert.equal(listed.status, 0, listed.stderr);
    const selected = JSON.parse(listed.stdout).cases.find((item: { name: string }) => item.name === 'cache-busy-native') as { id: string } | undefined;
    assert.ok(selected);
    const result = await command(root, ['test', 'discover', 'test/sample.ts']);
    assert.equal(result.status, 0, `the real adapter must collect while the service owns the parse cache: ${result.stderr}`);
    const observation = JSON.parse(result.stdout).observations[0].observation;
    assert.equal(observation.current, true);
    assert.deepEqual(observation.value.cases.map((item: { nativeId: string }) => item.nativeId), ['fixture:cache-busy-native']);
    const stored = await command(root, ['test', 'show', selected.id]);
    assert.equal(stored.status, 0, stored.stderr);
    const binding = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ bindings: Schema.NonEmptyArray(Schema.Struct({ testId: Schema.String, current: Schema.Boolean, nativeCases: Schema.Array(Schema.Struct({ nativeId: Schema.String })) })) })))(stored.stdout).bindings[0];
    assert.equal(binding.testId, selected.id);
    assert.equal(binding.current, true);
    assert.deepEqual(binding.nativeCases.map(item => item.nativeId), ['fixture:cache-busy-native'], 'a later independent command reads the collected binding');
    assert.equal(existsSync(join(root, '.git/concord/observation.lease')), false, 'collection releases observation ownership before returning');
    assert.equal(record(root).pid, pid, 'the existing service keeps its ownership');
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});
