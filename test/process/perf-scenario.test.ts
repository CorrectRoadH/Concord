// 跨进程保证：外部程序——扫描通过各自安装的真实入口启动子进程，并校验实际参数、输出与退出码。
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { executeScenario, makeContext, prepareScenario, scanCommand, type BenchScenario } from '../../scripts/perf/scenario.ts';
import { workDirectory } from '../../scripts/perf/workspace.ts';

const scan: BenchScenario = { id: 'local-data-engine/trace-gaps-refresh', consumer: 'self', state: 'warm', run: { scan: ['trace', 'gaps'] }, expect: { exitCode: 0 } };
const scanProgram = `process.stdout.write(JSON.stringify({ format: 'concord.query-scan/v1', ok: true, scannedAt: 1, finishedAt: 2, value: { argv: process.argv.slice(2), bun: process.versions.bun }, complete: true, unknown: [], drift: { files: [], directories: [], publicationChanged: false } }) + '\\n');`;

for (const shape of ['compiled', 'node', 'source'] as const) {
  // @feature docs/engineering/performance/README.md
  test(`scan driver executes the ${shape} installation with its actual arguments`, () => Effect.runPromise(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* workDirectory('concord-perf-scan-', false);
    for (const directory of ['bin', 'runtime', 'app/dist/entry/server', 'src/entry/cli', 'src/entry/server', 'runs', 'consumer']) yield* fs.makeDirectory(join(root, directory), { recursive: true });
    yield* fs.writeFileString(join(root, shape === 'source' ? 'package.json' : 'app/package.json'), '{"name":"concord-sdlc"}');
    const entry = join(root, shape === 'source' ? 'src/entry/cli/entry.ts' : 'bin/concord');
    yield* fs.writeFileString(entry, `#!/usr/bin/env bun\n${shape === 'node' ? 'process.exitCode = 9;' : scanProgram}`);
    yield* fs.chmod(entry, 0o755);
    if (shape !== 'source') yield* fs.writeFileString(join(root, 'runtime/rg'), 'fixture');
    if (shape === 'node') {
      yield* fs.writeFileString(join(root, 'runtime/node'), `#!/usr/bin/env bun\n${scanProgram}`);
      yield* fs.chmod(join(root, 'runtime/node'), 0o755);
      yield* fs.writeFileString(join(root, 'app/dist/entry/server/query-scan-worker.js'), '// JavaScript consumer entry fixture.');
    }
    if (shape === 'source') yield* fs.writeFileString(join(root, 'src/entry/server/query-scan-worker.ts'), scanProgram);
    const consumer = { kind: 'self', root: join(root, 'consumer'), commit: 'fixture' } as const;
    const context = makeContext({ label: 'candidate', dir: root, entry, commit: 'fixture', digest: 'fixture', dirty: false }, consumer, join(root, 'runs'));
    const result = yield* executeScenario(scan, context);
    const value = JSON.parse(result.stdout).value as { argv: string[]; bun: string };
    const suffix = [consumer.root, '["trace","gaps"]'];
    assert.deepEqual(value.argv, shape === 'compiled' ? ['--concord-internal', 'query-scan-worker', ...suffix] : shape === 'node' ? [join(root, 'app/dist/entry/server/query-scan-worker.js'), ...suffix] : suffix);
    assert.equal(value.bun, process.versions.bun);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));
}

// @feature docs/engineering/performance/README.md
test('scan entries fail explicitly when the selected installation is incomplete and ignore a sibling JavaScript fallback', () => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* workDirectory('concord-perf-scan-missing-', false);
  yield* fs.makeDirectory(join(root, 'src/entry/cli'), { recursive: true });
  yield* fs.writeFileString(join(root, 'package.json'), '{"name":"concord-sdlc"}');
  const entry = join(root, 'src/entry/cli/entry.ts');
  yield* fs.writeFileString(entry, '');
  yield* fs.writeFileString(join(root, 'src/entry/cli/query-scan-worker.js'), '// This is not an installation entry.');
  const source = yield* Effect.result(scanCommand(entry));
  assert.equal(source._tag, 'Failure');
  if (source._tag === 'Failure') assert.match(source.failure.message, /Missing source scan entry/u);
  for (const directory of ['app', 'bin', 'runtime']) yield* fs.makeDirectory(join(root, directory));
  yield* fs.writeFileString(join(root, 'app/package.json'), '{"name":"concord-sdlc"}');
  for (const file of ['bin/concord', 'runtime/rg', 'runtime/node']) yield* fs.writeFileString(join(root, file), '');
  const baseline = yield* Effect.result(scanCommand(join(root, 'bin/concord')));
  assert.equal(baseline._tag, 'Failure');
  if (baseline._tag === 'Failure') assert.match(baseline.failure.message, /Incomplete Node scan installation/u);
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));

for (const outcome of ['success', 'exit', 'json', 'mod'] as const) {
  // @feature docs/engineering/performance/README.md
  test(`cold preparation validates the actual ${outcome} scenario and preserves cache setup`, () => Effect.runPromise(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* workDirectory('concord-perf-cold-', false);
    const entry = join(root, 'cli.ts'), log = join(root, 'invocations');
    yield* fs.writeFileString(entry, `import { appendFileSync } from 'node:fs';
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, marker: process.env.CONCORD_COLD_MARKER }) + '\\n');
if (argv.includes('read')) {
  process.stdout.write(argv.includes('bad-json') ? '{}' : '{"ok":true}');
  if (argv.includes('bad-exit')) { process.stderr.write('cold failure'); process.exitCode = 7; }
} else if (argv.includes('herdr')) { process.stderr.write('Help requested'); process.exitCode = 1; }
`);
    const scenario: BenchScenario = { id: 'local-sdlc/cold-probe', consumer: 'self', state: 'warm', env: { CONCORD_COLD_MARKER: 'actual-driver' },
      run: outcome === 'mod' ? { mod: 'first-screen' } : { argv: ['read', outcome === 'exit' ? 'bad-exit' : outcome === 'json' ? 'bad-json' : 'ok'], concurrency: 2 },
      expect: { exitCode: 0, json: Schema.Struct({ ok: Schema.Literal(true) }) } };
    const context = makeContext({ label: 'candidate', dir: root, entry, commit: 'fixture', digest: 'fixture', dirty: false }, { kind: 'self', root, commit: 'fixture' }, root);
    const prepared = yield* Effect.result(prepareScenario(scenario, context, 'cold'));
    const invocations = (yield* fs.readFileString(log)).trim().split('\n').map(line => JSON.parse(line) as { argv: string[]; marker?: string });
    const calls = invocations.map(call => call.argv.slice(2));
    if (outcome === 'exit' || outcome === 'json') {
      assert.equal(prepared._tag, 'Failure');
      if (prepared._tag === 'Failure') assert.match(prepared.failure.message, outcome === 'exit' ? /exited 7.*cold failure/u : /Decode.*output/u);
      assert.deepEqual(calls[0], ['cache', 'clear']);
      assert.equal(calls.filter(call => call[0] === 'read').length, 2);
      assert.equal(calls.some(call => call.includes('rebuild')), false);
    } else {
      assert.equal(prepared._tag, 'Success');
      if (prepared._tag === 'Success') assert.equal(prepared.success?.exitCode, outcome === 'mod' ? undefined : 0);
      assert.deepEqual(calls[0], ['cache', 'clear']);
      assert.deepEqual(calls.at(-1), ['cache', 'rebuild']);
      assert.equal(calls.filter(call => call[0] === 'read').length, outcome === 'mod' ? 0 : 2);
    }
    for (const call of invocations.filter(call => call.argv.includes('read'))) assert.equal(call.marker, 'actual-driver');
    assert.equal(calls.some(call => call.includes('herdr')), false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));
}
