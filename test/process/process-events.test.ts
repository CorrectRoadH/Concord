// 跨进程保证：运行环境——Node 文件预加载关联真实文件，直接同步与异步子进程及产品适配事件合并去重。
// @concord-file
// @concord-implements docs/engineering/testing/README.md#成本与稳定
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, FileSystem, Schema } from 'effect';
import { NodeServices } from '@effect/platform-node';
import { writeProcessEventReport } from '../../scripts/process-events.ts';
import { ProcessEvent } from '../../src/base/process/index.ts';

// @feature docs/engineering/testing/README.md#成本与稳定
test('isolated file contexts count direct sync failures and async starts without double-counting product adapters', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-process-events-' });
  const fixture = join(root, 'fixture.test.ts');
  const unknown = join(root, 'unknown.test.ts');
  const output = join(root, 'output');
  yield* fs.makeDirectory(output);
  const cli = resolve('src/entry/cli/entry.ts');
  const owned = new URL('../../src/base/process/index.ts', import.meta.url).href;
  const effect = import.meta.resolve('effect');
  yield* fs.writeFileString(fixture, `
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync, execFile, fork } from 'node:child_process';
import { Effect } from ${JSON.stringify(effect)};
import { makeOwnedProcessService } from ${JSON.stringify(owned)};
test('starts', async () => {
 const args = [${JSON.stringify(cli)}, '--version'];
 assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 0);
 assert.match(execFileSync(process.execPath, args, { encoding: 'utf8' }), /dev/);
 assert.throws(() => execFileSync(process.execPath, [${JSON.stringify(cli)}, '--not-a-command'], { stdio: 'pipe' }));
 await new Promise((resolve, reject) => { const child = spawn(process.execPath, args, { stdio: 'ignore' }); child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(String(code)))); });
 await new Promise((resolve, reject) => execFile(process.execPath, args, {}, error => error ? reject(error) : resolve()));
 await new Promise((resolve, reject) => { const child = fork(${JSON.stringify(cli)}, ['--version'], { stdio: 'ignore' }); child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(String(code)))); });
 const result = await Effect.runPromise(Effect.scoped(makeOwnedProcessService().run([process.execPath, ...args], { cwd: process.cwd() })));
 assert.equal(result.exitCode, 0);
 assert.equal(spawnSync('git', ['--version']).status, 0);
 assert.equal(spawnSync('/does-not-exist/bin/concord', []).pid, 0);
});
`);
  yield* fs.writeFileString(unknown, `import test from 'node:test'; import { spawnSync } from 'node:child_process'; test('unknown', () => { spawnSync('sh', ['-c', 'true']); });`);
  const reporter = new URL('../../scripts/test-reporter.ts', import.meta.url).href;
  const reports = new URL('../../scripts/process-events.ts', import.meta.url).href;
  const services = import.meta.resolve('@effect/platform-node/NodeServices');
  const program = `import { Effect } from ${JSON.stringify(effect)}; import * as NodeServices from ${JSON.stringify(services)}; import { runNodeTests } from ${JSON.stringify(reporter)}; import { writeProcessEventReport } from ${JSON.stringify(reports)}; await Effect.runPromise(Effect.scoped(Effect.gen(function*(){ const failed = yield* runNodeTests({ files: ${JSON.stringify([fixture, unknown])}, concurrency: 1 }, ${JSON.stringify(output)}); yield* writeProcessEventReport(${JSON.stringify(output)}, ${JSON.stringify([fixture, unknown])}); if(failed) process.exitCode=1; })).pipe(Effect.provide(NodeServices.layer)));`;
  const runner = join(root, 'runner.ts');
  yield* fs.writeFileString(runner, program);
  const result = yield* Effect.sync(() => spawnSync(process.execPath, [runner], { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, CONCORD_TEST_EVENT_DIRECTORY: join(root, 'events'), NODE_TEST_CONTEXT: undefined } }));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const report = yield* writeProcessEventReport(output, [fixture, unknown]);
  assert.equal(report.files[0]?.status, 'complete', JSON.stringify(report));
  assert.equal(report.files[0]?.counts?.cli, 7);
  assert.equal(report.files[1]?.status, 'unknown');
  assert.equal(report.files[1]?.counts, null);
  const entries = yield* fs.readDirectory(join(root, 'events'));
  const events: ProcessEvent[] = [];
  for (const entry of entries) {
    const content = yield* fs.readFileString(join(root, 'events', entry));
    for (const line of content.trim().split('\n')) events.push(Schema.decodeUnknownSync(Schema.fromJsonString(ProcessEvent), { onExcessProperty: 'error' })(line));
  }
  const roots = events.filter(event => event.kind === 'coverage-start');
  assert.equal(roots.filter(event => event.file === fixture).length, 1);
  assert.equal(roots.filter(event => event.file === unknown).length, 1);
  assert.notEqual(roots[0]?.pid, roots[1]?.pid);
  assert.ok(roots.every(event => event.pid !== event.ppid));
  assert.equal(events.filter(event => event.kind === 'spawn' && event.role === 'cli').length, 7);
  assert.ok(!JSON.stringify(events).includes('CONCORD_TEST_EVENT_DIRECTORY'));
})).pipe(Effect.provide(NodeServices.layer))));
