// 跨进程保证：外部程序——实际编译并执行 Bun 程序，核对 profile 参数加载脚本和生成采样文件。
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { CpuProfile, profileRuntimeArgument } from '../../scripts/perf/cpu-profile.ts';
import { mustRun } from '../../scripts/perf/process.ts';
import { workDirectory } from '../../scripts/perf/workspace.ts';
import { packJavaScript } from '../../scripts/pack-javascript.ts';

// @feature docs/engineering/performance/cli.md
test('compiled profile loads its preload and writes CPU evidence to the requested directory', () => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* workDirectory('concord-profile-test-', false);
  const output = join(root, 'profiles'), entry = join(root, 'entry.ts'), preload = join(root, 'preload.ts'), executable = join(root, 'program');
  yield* fs.makeDirectory(output);
  yield* fs.writeFileString(entry, "console.log('application');\n");
  yield* fs.writeFileString(preload, "console.log('preloaded');\n");
  yield* mustRun(['bun', '--no-env-file', '--config=/dev/null', 'build', entry, '--compile', '--bytecode', '--format=esm', '--outfile', executable, profileRuntimeArgument(output, preload)], { cwd: root, outputDir: root, timeoutMs: 30_000 });
  const run = yield* mustRun([executable], { cwd: root, outputDir: root, timeoutMs: 10_000 });
  assert.equal(run.stdout, 'preloaded\napplication\n');
  const profiles = (yield* fs.readDirectory(output)).filter(name => name.endsWith('.cpuprofile'));
  assert.ok(profiles.length > 0);
  for (const name of profiles) {
    const profile = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(CpuProfile))(yield* fs.readFileString(join(output, name)));
    assert.ok(profile.nodes.length > 0);
  }
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));

// @feature docs/engineering/performance/cli.md
// @issue docs/issues/bun-profile-fs-bindings.md
test('compiled profile counts default and named filesystem calls without changing their results', () => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* workDirectory('concord-profile-counter-test-', false);
  const output = join(root, 'profiles'), entry = join(root, 'entry.ts'), executable = join(root, 'program');
  yield* fs.makeDirectory(output);
  yield* fs.writeFileString(join(root, 'data'), 'profile payload');
  yield* fs.writeFileString(entry, `import fs, { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
console.log(JSON.stringify([fs.readFileSync(process.argv[2], 'utf8'), readFileSync(process.argv[2], 'utf8'), await readFile(process.argv[2], 'utf8')]));\n`);
  yield* packJavaScript({ entry: { 'fs-counter': fileURLToPath(new URL('../../scripts/perf/fs-counter.ts', import.meta.url)) }, outDir: root,
    platform: 'node', format: 'esm', target: 'node24', logLevel: 'silent',
    deps: { alwaysBundle: /.*/u, onlyBundle: false }, outputOptions: { entryFileNames: '[name].mjs' },
  });
  yield* mustRun(['bun', '--no-env-file', '--config=/dev/null', 'build', entry, '--compile', '--bytecode', '--format=esm', '--outfile', executable, profileRuntimeArgument(output, join(root, 'fs-counter.mjs'))], { cwd: root, outputDir: root, timeoutMs: 30_000 });
  const run = yield* mustRun([executable, join(root, 'data')], { cwd: root, outputDir: root, timeoutMs: 10_000,
    env: { CONCORD_PERF_COUNTER_DIR: output, CONCORD_PERF_COUNTER_ROOT: root } });
  assert.deepEqual(JSON.parse(run.stdout), Array(3).fill('profile payload'));
  const names = (yield* fs.readDirectory(output)).filter(name => /^counter-\d+\.json$/u.test(name));
  assert.equal(names.length, 1);
  const counter = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ fs: Schema.Record(Schema.String, Schema.Struct({ count: Schema.Number, ms: Schema.Number })) })), { onExcessProperty: 'ignore' })(yield* fs.readFileString(join(output, names[0]!)));
  assert.equal(counter.fs.readFileSync?.count, 2);
  assert.equal(counter.fs['promises.readFile']?.count, 1);
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));
