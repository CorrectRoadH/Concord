// 跨进程保证：运行环境——轻量CLI loader在独立源码进程按内部协议加载skills命令并发布缺失指南。
import assert from 'node:assert/strict';
import { NodeServices } from '@effect/platform-node';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { Effect, FileSystem, Schema, Stream } from 'effect';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { SkillsInstallReceiptSchema, workflowSkillPaths } from '../../src/model/index.ts';
import { tmpdir } from '../support/temporary.ts';
import { LocalRepository } from '../support/repository.ts';
import { initialize } from '../support/operations.ts';

// @use-case docs/feature/project-onboarding/use-case/run-workflow-from-agent.md#install
test('the lightweight command loader routes skills install to the same managed publication', { timeout: 30_000 }, () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-workflow-loader-' });
  assert.equal(Number(yield* spawner.exitCode(ChildProcess.make('git', ['init', '-q', root]))), 0);
  yield* Effect.sync(() => {
    const repo = new LocalRepository(root, { initialize: true });
    try { initialize(repo); } finally { repo.close(); }
  });
  // Initialization installs these too; this case observes the loader creating absent guides.
  for (const path of workflowSkillPaths) yield* fs.remove(join(root, path));
  const bootstrap = join(root, 'light-entry.mts');
  // Internal loader protocol is a source-process exception, not a domain test.
  yield* fs.writeFileString(bootstrap, `import { loadCommand } from ${JSON.stringify(pathToFileURL(resolve('src/entry/cli/cli.ts')).href)};
import { runCommand, cliEnvironmentLayer } from ${JSON.stringify(pathToFileURL(resolve('src/entry/cli/main.ts')).href)};
import { Effect } from ${JSON.stringify(import.meta.resolve('effect'))};
import { NodeRuntime, NodeServices } from ${JSON.stringify(import.meta.resolve('@effect/platform-node'))};
const command = await loadCommand('skills', { format: 'concord.startup/v1', packageDigest: '', dataDigest: '', files: {}, sourceFiles: {}, receipts: {}, groups: [{ name: 'skills' }] });
NodeRuntime.runMain(runCommand(command, process.argv.slice(2)).pipe(Effect.tap(code => Effect.sync(() => { process.exitCode = code; })), Effect.provide(cliEnvironmentLayer(process.cwd(), process.env)), Effect.provide(NodeServices.layer)));\n`);
  const child = yield* spawner.spawn(ChildProcess.make(process.execPath, [bootstrap, '--root', root, '--json', 'skills', 'install'], {
    cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  }));
  const [stdout, stderr, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(child.stdout)), Stream.mkString(Stream.decodeText(child.stderr)), child.exitCode], { concurrency: 'unbounded' });
  assert.equal(Number(code), 0, JSON.stringify({ stdout, stderr, code }));
  const result = Schema.decodeUnknownSync(Schema.fromJsonString(SkillsInstallReceiptSchema), { onExcessProperty: 'error' })(stdout);
  assert.deepEqual(result.createdPaths, workflowSkillPaths);
})).pipe(Effect.provide(NodeServices.layer))));
