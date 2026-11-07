// 跨进程保证：外部程序——实际编译并执行 Bun 程序，核对 profile 参数加载脚本和生成采样文件。
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { CpuProfile, profileRuntimeArgument } from '../../scripts/perf/cpu-profile.ts';
import { mustRun } from '../../scripts/perf/process.ts';
import { workDirectory } from '../../scripts/perf/workspace.ts';

// @feature docs/engineering/performance/cli.md
// @issue docs/issues/compiled-profile-preload.md
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
