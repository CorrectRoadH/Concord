import assert from 'node:assert/strict';
import { NodeServices } from '@effect/platform-node';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { Deferred, Duration, Effect, Fiber, FileSystem, Schema, Scope, Stream } from 'effect';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { tmpdir } from '../support/temporary.js';

type Requirements = FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | Scope.Scope;
const runnerTest = (name: string, body: (root: string) => Effect.Effect<void, unknown, Requirements>) =>
  test(name, { timeout: 45_000 }, () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-runner-' });
    yield* body(root);
  })).pipe(Effect.provide(NodeServices.layer))));

const run = Effect.fn('test.runner.integration')(function*(args: string[], env: Record<string, string | undefined> = {}, cwd?: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make(process.execPath, ['--import', import.meta.resolve('tsx'), resolve('scripts/test-built.ts'), ...args], {
    env: { ...process.env, CONCORD_TEST_TIMINGS: undefined, CONCORD_TEST_COMPILE_CACHE: undefined, ...env },
    cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  }));
  const [text, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(child.all)), child.exitCode], { concurrency: 'unbounded' });
  const output = /# Test diagnostics: ([^\n]+)/u.exec(text)?.[1];
  assert.ok(output, text);
  return { text, code: Number(code), output };
});

const Counts = Schema.Struct({ tests: Schema.Number, failed: Schema.Number, cancelled: Schema.Number });
const Timing = Schema.Struct({ scope: Schema.String, counts: Counts });

// @feature docs/engineering/testing/README.md#检查入口
runnerTest('source tests run before the build receipt and release their Node budget before installed tests start', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const source = join(root, 'test/model/source.test.ts'), installed = join(root, 'test/cli/installed.test.ts');
  const packageRoot = join(root, 'package'), receipt = join(root, 'build-status.json'), released = join(root, 'source-released');
  yield* fs.makeDirectory(join(root, 'test/model'), { recursive: true });
  yield* fs.makeDirectory(join(root, 'test/cli'), { recursive: true });
  yield* fs.makeDirectory(packageRoot);
  yield* fs.writeFileString(join(packageRoot, 'package.json'), '{"name":"build-boundary-fixture"}');
  yield* fs.writeFileString(source, `import test from 'node:test'; import assert from 'node:assert/strict'; import { existsSync, writeFileSync, renameSync } from 'node:fs';
test('source runs during the build', t => {
  t.after(() => writeFileSync(${JSON.stringify(released)}, 'released'));
  assert.equal(process.env.CONCORD_TEST_PACKAGE_ROOT, undefined);
  assert.equal(existsSync(${JSON.stringify(receipt)}), false);
  writeFileSync(${JSON.stringify(`${receipt}.pending`)}, '{"code":0}');
  renameSync(${JSON.stringify(`${receipt}.pending`)}, ${JSON.stringify(receipt)});
});\n`);
  yield* fs.writeFileString(installed, `import test from 'node:test'; import assert from 'node:assert/strict'; import { existsSync } from 'node:fs'; import { spawnSync } from 'node:child_process';
test('installed waits for the build', () => {
  assert.equal(process.env.CONCORD_TEST_PACKAGE_ROOT, ${JSON.stringify(packageRoot)});
  assert.equal(existsSync(${JSON.stringify(receipt)}), true);
  assert.equal(existsSync(${JSON.stringify(released)}), true, 'the source group must release its Node file budget');
  const child = spawnSync(process.execPath, ['-e', 'console.log(process.env.NODE_OPTIONS ?? "")'], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.doesNotMatch(child.stdout, /tsx|concord-source|source-runtime/u);
});\n`);
  const result = yield* run(['--suite=node', source, installed], {
    NODE_OPTIONS: '', CONCORD_TEST_PACKAGE_ROOT: packageRoot, CONCORD_TEST_PACKAGE_BUILD_STATUS: receipt,
  }, root);
  assert.equal(result.code, 0, result.text);
  assert.ok(result.text.indexOf('# Source Node tests:') < result.text.indexOf('# Installed Node tests:'), result.text);
  const timings = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({ file: Schema.String }))))(yield* fs.readFileString(join(result.output, 'file-timings.json')));
  assert.deepEqual(timings.map(timing => timing.file).sort(), [source, installed].sort());
}));

// @feature docs/engineering/build/architecture.md#脚本只写项目特有的规则
runnerTest('cancelling gate reaps static task groups that ignore SIGTERM and releases its cache', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const record = Schema.fromJsonString(Schema.Struct({ pid: Schema.Number, cache: Schema.String, cgroup: Schema.String, packageRoot: Schema.optional(Schema.String), task: Schema.String }));
  const fakePnpm = join(root, 'pnpm.ts');
  yield* fs.writeFileString(fakePnpm, `#!/usr/bin/env -S node --import ${import.meta.resolve('tsx')}
import { writeFileSync, readFileSync } from 'node:fs';
process.on('SIGTERM', () => {});
const task = process.argv[4] === 'build' ? 'build' : process.argv[5];
writeFileSync(${JSON.stringify(root)} + '/' + task + '.json', JSON.stringify({task, pid: process.pid, cache: process.env.CONCORD_TEST_COMPILE_CACHE, packageRoot: process.env.CONCORD_TEST_PACKAGE_ROOT, cgroup: process.platform === 'linux' ? readFileSync('/proc/self/cgroup', 'utf8') : ''}));
console.log('TASK_READY');
setInterval(() => {}, 1000);
`);
  yield* fs.chmod(fakePnpm, 0o755);
  yield* fs.symlink(fakePnpm, join(root, 'pnpm'));
  // Keep a failed cleanup regression from leaking the deliberately stubborn boundary.
  yield* Effect.addFinalizer(() => Effect.gen(function*() {
    for (const file of (yield* fs.readDirectory(root)).filter(file => file.endsWith('.json'))) {
      const { pid, cache } = Schema.decodeUnknownSync(record)(yield* fs.readFileString(join(root, file)));
      yield* Effect.sync(() => { try { process.kill(-pid, 'SIGKILL'); } catch {} });
      yield* fs.remove(cache, { recursive: true, force: true });
    }
  }).pipe(Effect.orDie));
  const child = yield* spawner.spawn(ChildProcess.make(process.execPath, ['--import', import.meta.resolve('tsx'), resolve('scripts/gate.ts')], {
    env: { ...process.env, CONCORD_GATE_SCOPE: undefined, CONCORD_GATE_REPORT: undefined, PATH: `${root}:${process.env.PATH}` },
    stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', forceKillAfter: Duration.seconds(10),
  }));
  const ready = yield* Deferred.make<void>();
  let output = '';
  const drain = yield* Stream.runForEach(Stream.decodeText(child.all), text => Effect.gen(function*() {
    output += text;
    if (output.split('TASK_READY').length === 8) yield* Deferred.succeed(ready, undefined);
  })).pipe(Effect.forkScoped);
  yield* Deferred.await(ready).pipe(Effect.timeout(Duration.seconds(20)));
  const processes = yield* Effect.forEach((yield* fs.readDirectory(root)).filter(file => file.endsWith('.json')), file => fs.readFileString(join(root, file)).pipe(Effect.map(Schema.decodeUnknownSync(record))));
  assert.equal(processes.length, 7);
  assert.equal(processes.filter(process => process.task === 'build').length, 1);
  const packageRoot = processes.find(process => process.task === 'build')!.packageRoot;
  assert.ok(packageRoot, output);
  assert.equal(processes.find(process => process.task === 'test:source')!.packageRoot, packageRoot);
  assert.equal(yield* fs.exists(resolve(packageRoot, '..')), true);
  const resourcePath = /# Gate resource report: ([^\n]+)/u.exec(output)?.[1];
  assert.ok(resourcePath, output);
  const resources = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ memoryIsolation: Schema.String, unit: Schema.NullOr(Schema.String), cgroup: Schema.NullOr(Schema.String) })))(yield* fs.readFileString(resourcePath));
  if (resources.memoryIsolation === 'systemd-scope') {
    for (const child of processes) assert.ok(child.cgroup.includes(`/${resources.unit}`), child.cgroup);
    const parentGroup = yield* fs.readFileString('/proc/self/cgroup');
    assert.equal(parentGroup.includes(resources.unit!), false);
  }
  yield* child.kill({ killSignal: 'SIGTERM', forceKillAfter: Duration.seconds(10) });
  yield* Fiber.join(drain).pipe(Effect.timeout(Duration.seconds(1)), Effect.ignore);
  if (resources.cgroup !== null) assert.equal(yield* fs.exists(resources.cgroup), false, `leaked scope ${resources.unit}`);
  assert.equal(yield* fs.exists(resolve(packageRoot, '..')), false, `leaked temporary package ${packageRoot}`);
  for (const { pid, cache } of processes) {
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `leaked task PID ${pid}\n${output}`);
    assert.equal(yield* fs.exists(cache), false, `leaked compile cache ${cache}`);
  }
}));

// @feature docs/engineering/testing/cli.md#完整门禁
runnerTest('official file diagnostics sort durations and count isolated file processes once', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const directory = join(root, 'test/model');
  yield* fs.makeDirectory(directory, { recursive: true });
  const first = join(directory, 'first.test.ts'), second = join(directory, 'second.test.ts');
  // A case may legally have the same title as its file wrapper.
  yield* fs.writeFileString(first, `import test from 'node:test'; test(${JSON.stringify(first)}, () => {});\n`);
  yield* fs.writeFileString(second, `import { describe, test } from 'node:test'; describe('suite', () => { test('first nested', () => {}); test('second nested', () => {}); });\n`);
  const result = yield* run(['--suite=node', first, second], { CONCORD_TEST_CONCURRENCY: '1' }, root);
  assert.equal(result.code, 0, result.text);
  const timings = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({ file: Schema.String, duration_ms: Schema.Number }))))(yield* fs.readFileString(join(result.output, 'file-timings.json')));
  assert.deepEqual(timings.map(timing => timing.file).sort(), [first, second].sort());
  assert.deepEqual(timings.map(timing => timing.duration_ms), timings.map(timing => timing.duration_ms).sort((left, right) => right - left));
  const cases = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({ cases: Schema.Number }))))(yield* fs.readFileString(join(result.output, 'file-timings.json')));
  assert.equal(cases.reduce((sum, file) => sum + file.cases, 0), 3, 'official summaries count cases, not suites or file wrappers');
  const layers = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({ layer: Schema.String, files: Schema.Number, cases: Schema.Number, countedFiles: Schema.Number, duration_ms: Schema.Number }))))(yield* fs.readFileString(join(result.output, 'layer-timings.json')));
  assert.deepEqual(layers.find(layer => layer.layer === 'model'), { layer: 'model', files: 2, cases: 3, countedFiles: 2, duration_ms: timings.reduce((sum, file) => sum + file.duration_ms, 0) });
  const summaries = (yield* fs.readFileString(join(result.output, 'node-timings.jsonl'))).trim().split('\n').map(line => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ scope: Schema.String, fileProcessStarts: Schema.optional(Schema.Number) })))(line));
  assert.equal(summaries.find(summary => summary.scope === 'run')?.fileProcessStarts, 2);
}));

runnerTest('official TAP retains circular failure diagnostics and reaches its run summary', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const file = join(root, 'circular.test.ts');
  yield* fs.writeFileString(file, `import ${JSON.stringify(pathToFileURL(resolve('test/fixtures/reporter-circular-error.ts')).href)};\n`);
  const result = yield* run(['--suite=node', file]);
  assert.equal(result.code, 1, result.text);
  assert.doesNotMatch(result.text, /Converting circular structure|uncaughtException/u);
  assert.match(result.text, /not ok 1 - intentional circular error fixture/u);
  const timings = (yield* fs.readFileString(join(result.output, 'node-timings.jsonl'))).trim().split('\n').map(line => Schema.decodeUnknownSync(Schema.fromJsonString(Timing))(line));
  const summary = timings.find(timing => timing.scope === 'run');
  assert.deepEqual(summary?.counts, { tests: 1, failed: 1, cancelled: 0 });
  const diagnostic = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ name: Schema.String, error: Schema.String })))((yield* fs.readFileString(join(result.output, 'node-failures.jsonl'))).trim().split('\n')[0]);
  assert.match(diagnostic.error, /intentional circular reporter failure/u);
  assert.ok((yield* fs.readDirectory(join(result.output, 'node'))).some(name => name.startsWith('circular.test.ts-')));
  assert.equal(yield* fs.exists(join(result.output, 'node-compile-cache')), false);
}));

runnerTest('official name filtering and shard union select each requested source test exactly once', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const files: string[] = [];
  for (const name of ['alpha', 'beta', 'gamma']) {
    const file = join(root, `${name}.test.ts`);
    yield* fs.writeFileString(file, `import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('selected ${name}', () => { assert.ok(process.execArgv.some(arg => arg.includes('concord-source'))); assert.ok(process.execArgv.some(arg => arg.includes('source-runtime'))); });\ntest('excluded ${name}', () => assert.fail('name filter was lost'));\n`);
    files.push(file);
  }
  const observed: string[] = [];
  for (const shard of ['1/2', '2/2']) {
    const result = yield* run(['--suite=node', '--test-name-pattern=selected', `--test-shard=${shard}`, ...files]);
    assert.equal(result.code, 0, result.text);
    const timings = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({ file: Schema.String }))))(yield* fs.readFileString(join(result.output, 'file-timings.json')));
    observed.push(...timings.map(timing => timing.file));
    assert.doesNotMatch(result.text, /name filter was lost/u);
  }
  assert.deepEqual(observed.sort(), [...files].sort());
}));

runnerTest('official glob discovery and test timeout keep source runs isolated and clean resources', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const directory = join(root, 'test', 'nested');
  yield* fs.makeDirectory(directory, { recursive: true });
  const pidFile = join(root, 'timed-out-child');
  yield* fs.writeFileString(join(directory, 'timeout.test.ts'), `import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
test('timeout fixture', { timeout: 100 }, async t => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'ignore'});
  writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
  t.after(async () => { const exited = once(child, 'exit'); child.kill(); await exited; });
  await new Promise(resolve => setTimeout(resolve, 150));
});
`);
  yield* fs.writeFileString(join(directory, 'pass.test.ts'), `import test from 'node:test'; test('discovered source fixture', () => {});\n`);
  yield* fs.writeFileString(join(directory, 'excluded.ts'), `throw new Error('not a test file');\n`);
  const result = yield* run(['--suite=node'], {}, root);
  assert.equal(result.code, 1, result.text);
  assert.match(result.text, /test timed out after 100ms/u);
  assert.match(result.text, /ok \d+ - discovered source fixture/u);
  assert.doesNotMatch(result.text, /not a test file/u);
  const pid = Schema.decodeUnknownSync(Schema.NumberFromString)(yield* fs.readFileString(pidFile));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}));

runnerTest('Node and browser failures leave the other suite running and retain official browser arguments', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString(join(root, 'package.json'), JSON.stringify({ private: true }));
  const browser = join(root, 'route.e2e.ts'), node = join(root, 'route.test.ts');
  const browserArgs = join(root, 'browser-args.json'), nodeDone = join(root, 'node-done');
  yield* fs.writeFileString(browser, 'export {};\n');
  const fakePnpm = join(root, 'pnpm.ts');
  yield* fs.writeFileString(fakePnpm, `#!/usr/bin/env -S node --import ${import.meta.resolve('tsx')}\nimport { writeFileSync } from 'node:fs';\nsetTimeout(() => { writeFileSync(${JSON.stringify(browserArgs)}, JSON.stringify(process.argv.slice(2))); console.log('BROWSER_EXECUTED'); process.exitCode = Number(process.env.BROWSER_EXIT); }, 150);\n`);
  yield* fs.chmod(fakePnpm, 0o755);
  yield* fs.symlink(fakePnpm, join(root, 'pnpm'));
  const env = { PATH: `${root}:${process.env.PATH}`, CONCORD_E2E_WORKERS: '2', CONCORD_TEST_PACKAGE_ROOT: root };
  yield* fs.writeFileString(node, `import test from 'node:test';\ntest('selected', () => { throw new Error('NODE_EXPECTED_FAILURE'); });\n`);
  const nodeFailed = yield* run(['--test-name-pattern=selected', '--test-shard=1/1', node, browser], { ...env, BROWSER_EXIT: '0' });
  assert.equal(nodeFailed.code, 1, nodeFailed.text);
  assert.match(nodeFailed.text, /NODE_EXPECTED_FAILURE/u);
  assert.match(nodeFailed.text, /BROWSER_EXECUTED/u);
  const args = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(yield* fs.readFileString(browserArgs));
  assert.deepEqual(args, ['exec', 'e2e', 'run', '--config', 'e2e.config.ts', '--no-cache', '--workers', '2', '--grep', 'selected', '--shard', '1/1', browser]);
  yield* fs.writeFileString(node, `import test from 'node:test';\nimport { writeFileSync } from 'node:fs';\ntest('selected', async () => { await new Promise(resolve => setTimeout(resolve, 250)); writeFileSync(${JSON.stringify(nodeDone)}, 'done'); });\n`);
  const browserFailed = yield* run([node, browser], { ...env, BROWSER_EXIT: '1' });
  assert.equal(browserFailed.code, 1, browserFailed.text);
  assert.equal(yield* fs.readFileString(nodeDone), 'done');
  assert.match(browserFailed.text, /ok 1 - selected/u);
}));

runnerTest('cancelling the source runner reaps test processes and descendants that ignore SIGTERM', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const file = join(root, 'cancel.test.ts'), pids = join(root, 'pids.json');
  yield* fs.writeFileString(file, `import { spawn } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\nimport test from 'node:test';\nprocess.on('SIGTERM', () => {});\nconst child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); process.stdout.write("READY"); setInterval(()=>{},1000)'], {stdio:['ignore','pipe','ignore']});\nchild.stdout.once('data', () => { writeFileSync(${JSON.stringify(pids)}, JSON.stringify([process.ppid, process.pid, child.pid])); console.log('FIXTURE_READY'); });\ntest('hang until cancelled', () => new Promise(()=>{setInterval(()=>{},1000)}));\n`);
  const child = yield* spawner.spawn(ChildProcess.make(process.execPath, ['--import', 'tsx', 'scripts/test-built.ts', '--suite=node', file], {
    stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', forceKillAfter: Duration.seconds(10),
    env: { ...process.env, CONCORD_TEST_COMPILE_CACHE: undefined, CONCORD_TEST_TIMINGS: undefined },
  }));
  const ready = yield* Deferred.make<void>();
  let text = '';
  const drain = yield* Stream.runForEach(Stream.decodeText(child.all), chunk => Effect.gen(function*() {
    text += chunk;
    if (text.includes('FIXTURE_READY')) yield* Deferred.succeed(ready, undefined);
  })).pipe(Effect.forkScoped);
  yield* Deferred.await(ready).pipe(Effect.timeout(Duration.seconds(20)));
  const processes = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Number)))(yield* fs.readFileString(pids));
  yield* child.kill({ killSignal: 'SIGTERM', forceKillAfter: Duration.seconds(10) });
  yield* Fiber.join(drain);
  for (const pid of processes) {
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `leaked PID ${pid}\n${text}`);
  }
  const output = /# Test diagnostics: ([^\n]+)/u.exec(text)?.[1];
  assert.ok(output, text);
  assert.equal(yield* fs.exists(join(output, 'node-compile-cache')), false);
}));
