// 跨进程保证：运行环境——Bun 文件预加载关联真实文件，受支持的子进程探针与产品适配事件合并去重，完整观测缺失时报告未知。
// @concord-file
// @concord-implements docs/engineering/testing/README.md#成本与稳定
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, FileSystem, Schema } from 'effect';
import { NodeServices } from '@effect/platform-node';
import { ProcessEvent } from '../../src/base/process/index.ts';

// @feature docs/engineering/testing/README.md#成本与稳定
test('isolated Bun files preserve exact observed starts without claiming complete hook coverage', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-process-events-' });
  const fixture = join(root, 'fixture.test.ts');
  const unknown = join(root, 'unknown.test.ts');
  const eventsDirectory = join(root, 'events');
  yield* fs.makeDirectory(eventsDirectory);
  const cli = resolve('src/entry/cli/entry.ts');
  const owned = new URL('../../src/base/process/index.ts', import.meta.url).href;
  const runtime = new URL('../../src/base/environment/index.ts', import.meta.url).href;
  const effect = import.meta.resolve('effect');
  yield* fs.writeFileString(fixture, `
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync, execFile, fork } from 'node:child_process';
import { Effect } from ${JSON.stringify(effect)};
import { makeOwnedProcessService } from ${JSON.stringify(owned)};
import { makeRuntimeEnvironment } from ${JSON.stringify(runtime)};
test('starts', async () => {
 const args = [${JSON.stringify(cli)}, '--version'];
 assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 0);
 assert.match(execFileSync(process.execPath, args, { encoding: 'utf8' }), /dev/);
 assert.throws(() => execFileSync(process.execPath, [${JSON.stringify(cli)}, '--not-a-command'], { stdio: 'pipe' }));
 await new Promise((resolve, reject) => { const child = spawn(process.execPath, args, { stdio: 'ignore' }); child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(String(code)))); });
 await new Promise((resolve, reject) => execFile(process.execPath, args, {}, error => error ? reject(error) : resolve()));
 await new Promise((resolve, reject) => { const child = fork(${JSON.stringify(cli)}, ['--version'], { stdio: 'ignore' }); child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(String(code)))); });
 const result = await Effect.runPromise(Effect.scoped(makeOwnedProcessService({ environment: makeRuntimeEnvironment(process.cwd(), process.env) }).run([process.execPath, ...args], { cwd: process.cwd() })));
 assert.equal(result.exitCode, 0);
 assert.equal(spawnSync('git', ['--version']).status, 0);
 const missing = spawnSync('/does-not-exist/bin/concord', []);
 assert.equal(missing.error?.code, 'ENOENT');
});
`);
  yield* fs.writeFileString(unknown, `import test from 'node:test'; import { spawnSync } from 'node:child_process'; test('unknown', () => { spawnSync('sh', ['-c', 'true']); });`);
  const result = yield* Effect.sync(() => spawnSync(process.execPath, ['test', '--no-env-file', '--config=/dev/null',
    '--conditions=concord-source', '--preload', resolve('test/support/source-runtime.ts'), '--parallel=1', '--timeout=60000', fixture, unknown], {
    cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, CONCORD_TEST_RUN_ID: 'file-lifecycle-run',
      CONCORD_TEST_EVENT_DIRECTORY: eventsDirectory, CONCORD_TEST_FILE_ID: undefined, NODE_TEST_CONTEXT: undefined },
  }));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const entries = yield* fs.readDirectory(eventsDirectory);
  const events: ProcessEvent[] = [];
  for (const entry of entries) {
    const content = yield* fs.readFileString(join(root, 'events', entry));
    for (const line of content.trim().split('\n')) events.push(Schema.decodeUnknownSync(Schema.fromJsonString(ProcessEvent), { onExcessProperty: 'error' })(line));
  }
  const roots = events.filter(event => event.kind === 'coverage-start');
  assert.equal(roots.filter(event => event.file === fixture).length, 1);
  assert.equal(roots.filter(event => event.file === unknown).length, 1);
  assert.equal(roots[0]?.pid, roots[1]?.pid, 'one official worker can execute both isolated files');
  for (const file of [fixture, unknown]) {
    const started = events.filter(event => event.file === file && event.kind === 'coverage-start');
    const ended = events.filter(event => event.file === file && event.kind === 'coverage-end');
    assert.equal(started.length, 1);
    assert.equal(ended.length, 1, 'the real file after hook must close each association');
    assert.equal(ended[0]?.pid, started[0]?.pid);
    assert.equal(ended[0]?.healthy, false, 'incomplete Bun hooks cannot claim complete coverage');
    assert.ok(events.some(event => event.file === file && event.kind === 'unknown'));
  }
  assert.ok(events.every(event => event.run === 'file-lifecycle-run'));
  assert.ok(roots.every(event => event.pid !== event.ppid));
  assert.equal(events.filter(event => event.kind === 'spawn' && event.role === 'cli').length, 7);
  assert.equal(new Set(events.filter(event => event.kind === 'spawn' && event.role === 'cli').map(event => event.id)).size, 7);
  assert.ok(!JSON.stringify(events).includes('CONCORD_TEST_EVENT_DIRECTORY'));
})).pipe(Effect.provide(NodeServices.layer))));
