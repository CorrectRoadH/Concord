import assert from 'node:assert/strict';
import { NodeServices } from '@effect/platform-node';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import type { Scope} from 'effect';
import { Deferred, Duration, Effect, Fiber, FileSystem, Schema, Stream } from 'effect';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { tmpdir } from '../support/temporary.ts';
import { selectsPackagingTest } from '../../scripts/gate-package.ts';

type Requirements = FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | Scope.Scope;
const runnerTest = (name: string, body: (root: string) => Effect.Effect<void, unknown, Requirements>) =>
  test(name, { timeout: 45_000 }, () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-runner-' });
    yield* body(root);
  })).pipe(Effect.provide(NodeServices.layer))));

const run = Effect.fn('test.runner.integration')(function*(args: string[], env: Record<string, string | undefined> = {}, cwd?: string, onOutput?: (chunk: string) => void) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make(process.execPath, [resolve('scripts/test-built.ts'), ...args], {
    env: { ...process.env, CONCORD_TEST_TIMINGS: undefined, CONCORD_TEST_COMPILE_CACHE: undefined, ...env },
    cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  }));
  const [text, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(child.all).pipe(Stream.tap(chunk => Effect.sync(() => onOutput?.(chunk))))), child.exitCode], { concurrency: 'unbounded' });
  const output = /# Test diagnostics: ([^\n]+)/u.exec(text)?.[1];
  assert.ok(output, text);
  return { text, code: Number(code), output };
});

const Counts = Schema.Struct({ tests: Schema.Number, failed: Schema.Number, cancelled: Schema.Number });
const Timing = Schema.Struct({ scope: Schema.String, counts: Counts });

// @feature docs/engineering/testing/README.md#检查入口
runnerTest('all Node layers run source without a package and preserve the shared compile cache', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const source = join(root, 'test/model/source.test.ts'), cli = join(root, 'test/cli/source.test.ts');
  const child = join(root, 'typed-child.ts');
  const cacheHome = join(root, 'shared-cache'), compileCache = join(cacheHome, 'concord/node-compile');
  yield* fs.makeDirectory(join(root, 'test/model'), { recursive: true });
  yield* fs.makeDirectory(join(root, 'test/cli'), { recursive: true });
  yield* fs.writeFileString(child, `const value: number = 42; console.log(JSON.stringify({value, options: process.env.NODE_OPTIONS, cache: process.env.NODE_COMPILE_CACHE}));\n`);
  for (const file of [source, cli]) yield* fs.writeFileString(file, `import test from 'node:test'; import assert from 'node:assert/strict'; import { spawnSync } from 'node:child_process';
test('source uses native type erasure', () => {
  assert.equal(process.env.CONCORD_TEST_PACKAGE_ROOT, undefined);
  assert.equal(process.env.CONCORD_TEST_PACKAGE_BUILD_STATUS, undefined);
  assert.ok(process.execArgv.includes('--conditions=concord-source'));
  assert.ok(process.execArgv.every(arg => !arg.includes('tsx')));
  const child = spawnSync(process.execPath, [${JSON.stringify(child)}], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.value, 42);
  assert.match(result.options, /--conditions=concord-source/u);
  assert.doesNotMatch(result.options, /tsx/u);
  assert.equal(result.cache, ${JSON.stringify(compileCache)});
});\n`);
  yield* fs.writeFileString(join(root, 'absent-receipt'), '{"code":1}');
  const env = { NODE_OPTIONS: '', XDG_CACHE_HOME: cacheHome, CONCORD_TEST_PACKAGE_ROOT: join(root, 'absent-package'), CONCORD_TEST_PACKAGE_BUILD_STATUS: join(root, 'absent-receipt') };
  const result = yield* run(['--suite=node', source, cli], env, root);
  assert.equal(result.code, 0, result.text);
  assert.match(result.text, /# Source Node tests:/u);
  assert.doesNotMatch(result.text, /# Installed Node tests:/u);
  const timings = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({ file: Schema.String }))))(yield* fs.readFileString(join(result.output, 'file-timings.json')));
  assert.deepEqual(timings.map(timing => timing.file).sort(), [source, cli].sort());
  assert.equal(yield* fs.exists(compileCache), true);
  const sentinel = join(compileCache, 'retained');
  yield* fs.writeFileString(sentinel, 'shared cache survives runner lifetime');
  const again = yield* run(['--suite=node', source, cli], env, root);
  assert.equal(again.code, 0, again.text);
  assert.equal(yield* fs.readFileString(sentinel), 'shared cache survives runner lifetime');
}));

// @feature docs/engineering/testing/README.md#打包测试
runnerTest('archive preparation gates only packaging and preserves official shard and case reports', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const source = join(root, 'test/model/source.test.ts'), packaging = join(root, 'test/process/release-package.test.ts');
  const receipt = join(root, 'preparation.json'), sourceDone = join(root, 'source-done'), packageDone = join(root, 'package-done');
  const sourceStarted = join(root, 'source-started'), sourceRelease = join(root, 'source-release');
  const packagingWaiting = yield* Deferred.make<void>();
  yield* fs.makeDirectory(join(root, 'test/model'), { recursive: true });
  yield* fs.makeDirectory(join(root, 'test/process'), { recursive: true });
  yield* fs.writeFileString(receipt, JSON.stringify({ state: 'pending' }));
  yield* fs.writeFileString(source, `import test from 'node:test'; import assert from 'node:assert/strict'; import {existsSync,writeFileSync,watchFile,unwatchFile} from 'node:fs';
test('ordinary source starts before archive readiness', async () => {
  assert.equal(process.env.CONCORD_TEST_PACKAGE_ROOT, undefined); assert.equal(process.env.CONCORD_GATE_PACKAGE_PREPARATION, undefined);
  writeFileSync(${JSON.stringify(sourceStarted)}, 'started');
  await new Promise(resolve => {
    const release = () => { if (existsSync(${JSON.stringify(sourceRelease)})) { unwatchFile(${JSON.stringify(sourceRelease)}, release); resolve(); } };
    watchFile(${JSON.stringify(sourceRelease)}, {interval: 10}, release); release();
  });
  writeFileSync(${JSON.stringify(sourceDone)}, 'done');
});\n`);
  yield* fs.writeFileString(packaging, `import test from 'node:test'; import assert from 'node:assert/strict'; import {existsSync,writeFileSync} from 'node:fs';
test('packaging receives ready archive only', () => { assert.equal(process.env.CONCORD_TEST_PACKAGE_ROOT, ${JSON.stringify(join(root, 'archive'))}); assert.equal(process.env.CONCORD_GATE_PACKAGE_PREPARATION, undefined); assert.ok(existsSync(${JSON.stringify(sourceDone)})); writeFileSync(${JSON.stringify(packageDone)}, 'done'); });\n`);
  assert.equal(selectsPackagingTest([source, packaging], ['--test-shard=1/2'], root), false);
  assert.equal(selectsPackagingTest([source, packaging], ['--test-shard=2/2'], root), true);
  assert.equal(selectsPackagingTest([source, packaging], ['--suite=e2e'], root), false);
  let observed = '';
  const running = yield* run(['--suite=node', source, packaging], {
    CONCORD_GATE_PACKAGE_PREPARATION: receipt, CONCORD_TEST_PACKAGE_ROOT: undefined, CONCORD_TEST_CONCURRENCY: '2',
  }, root, chunk => {
    observed += chunk;
    if (observed.includes('# Packaging waits for Source Node completion')) Deferred.doneUnsafe(packagingWaiting, Effect.void);
  }).pipe(Effect.forkScoped);
  yield* Effect.gen(function*() {
    while (!(yield* fs.exists(sourceStarted))) yield* Effect.sleep('10 millis');
  }).pipe(Effect.timeout('20 seconds'));
  assert.equal(yield* fs.exists(packageDone), false, 'pending archive must not start the packaging test process');
  const temporary = `${receipt}.ready`;
  yield* fs.writeFileString(temporary, JSON.stringify({ state: 'ready', code: 0, packageRoot: join(root, 'archive'), duration_ms: 12_345, digest: 'fixture', cache: 'hit' }));
  yield* fs.rename(temporary, receipt);
  yield* Deferred.await(packagingWaiting).pipe(Effect.timeoutOrElse({
    duration: '15 seconds', orElse: () => Effect.sync(() => assert.fail(`Packaging did not wait for active source work:\n${observed}`)),
  }));
  assert.equal(yield* fs.exists(sourceDone), false, 'source work remains active when the archive becomes ready');
  assert.equal(yield* fs.exists(packageDone), false, 'ready archive must wait for the source group to release its memory');
  yield* fs.writeFileString(sourceRelease, 'release');
  const result = yield* Fiber.join(running);
  assert.equal(result.code, 0, result.text);
  assert.match(result.text, /# Packaging Node tests:/u);
  assert.equal(yield* fs.exists(packageDone), true);
  const timings = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({ file: Schema.String, cases: Schema.Number }))))(yield* fs.readFileString(join(result.output, 'file-timings.json')));
  assert.deepEqual(timings.map(row => row.file).sort(), [source, packaging].sort());
  assert.equal(timings.reduce((sum, row) => sum + row.cases, 0), 2);
  for (const group of ['node-source', 'node-package']) assert.equal(yield* fs.exists(join(result.output, group, 'node-timings.jsonl')), true);
}));

// @feature docs/engineering/build/architecture.md#脚本只写项目特有的规则
runnerTest('cancelling gate reaps static task groups and fixture scratch while preserving its shared cache', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const record = Schema.fromJsonString(Schema.Struct({ pid: Schema.Number, cache: Schema.String, cgroup: Schema.String, packageRoot: Schema.optional(Schema.String), fixtureRoot: Schema.optional(Schema.String), task: Schema.String }));
  const fakePnpm = join(root, 'pnpm.ts');
  yield* fs.writeFileString(fakePnpm, `#!/usr/bin/env node
import { writeFileSync, readFileSync } from 'node:fs';
process.on('SIGTERM', () => {});
const task = process.argv[4] === 'build' ? 'build' : process.argv[5];
writeFileSync(${JSON.stringify(root)} + '/' + task + '.json', JSON.stringify({task, pid: process.pid, cache: process.env.CONCORD_TEST_COMPILE_CACHE, packageRoot: process.env.CONCORD_TEST_PACKAGE_ROOT, fixtureRoot: process.env.TMPDIR, cgroup: process.platform === 'linux' ? readFileSync('/proc/self/cgroup', 'utf8') : ''}));
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
  const child = yield* spawner.spawn(ChildProcess.make(process.execPath, [resolve('scripts/gate.ts'), 'test/model/test-reporter.test.ts'], {
    env: { ...process.env, CONCORD_GATE_SCOPE: undefined, CONCORD_GATE_REPORT: undefined, XDG_CACHE_HOME: join(root, 'shared-cache'), CONCORD_GATE_QUEUE_DIRECTORY: join(root, 'gate-queue'), PATH: `${root}:${process.env.PATH}` },
    stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', forceKillAfter: Duration.seconds(10),
  }));
  const ready = yield* Deferred.make<void>();
  let output = '';
  const drain = yield* Stream.runForEach(Stream.decodeText(child.all), text => Effect.gen(function*() {
    output += text;
    if (output.split('TASK_READY').length === 8) yield* Deferred.succeed(ready, undefined);
  })).pipe(Effect.forkScoped);
  yield* Deferred.await(ready).pipe(Effect.timeout(Duration.seconds(20)), Effect.catch(() => Effect.sync(() => assert.fail(`Gate tasks did not become ready:\n${output}`))));
  const processes = yield* Effect.forEach((yield* fs.readDirectory(root)).filter(file => file.endsWith('.json')), file => fs.readFileString(join(root, file)).pipe(Effect.map(Schema.decodeUnknownSync(record))));
  assert.equal(processes.length, 7);
  assert.equal(processes.filter(process => process.task === 'build').length, 0);
  for (const process of processes) assert.equal(process.packageRoot, undefined);
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
  assert.equal(yield* fs.exists(processes.find(process => process.task === 'test:source')!.fixtureRoot!), false, 'the gate owns and removes its fixture scratch directory');
  for (const { pid, cache } of processes) {
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `leaked task PID ${pid}\n${output}`);
    assert.equal(cache, join(root, 'shared-cache/concord/node-compile'));
    assert.equal(yield* fs.exists(cache), true, `shared compile cache removed ${cache}`);
  }
}));

// @use-case docs/engineering/testing/use-case/split-slow-test.md#find
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
  yield* fs.writeFileString(fakePnpm, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nsetTimeout(() => { writeFileSync(${JSON.stringify(browserArgs)}, JSON.stringify(process.argv.slice(2))); console.log('BROWSER_EXECUTED'); process.exitCode = Number(process.env.BROWSER_EXIT); }, 150);\n`);
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
  const child = yield* spawner.spawn(ChildProcess.make(process.execPath, ['scripts/test-built.ts', '--suite=node', file], {
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

// @feature docs/engineering/testing/cli.md#并发
runnerTest('seven GiB admission bounds override concurrency and releases a failed file before starting its successor', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const files: string[] = [];
  const active = join(root, 'active');
  for (const name of ['first', 'second', 'third', 'fourth']) {
    const file = join(root, `${name}.test.ts`);
    files.push(file);
    yield* fs.writeFileString(file, `import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, watchFile, unwatchFile, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
test(${JSON.stringify(name)}, async () => {
  mkdirSync(${JSON.stringify(active)}, {recursive:true});
  const own = join(${JSON.stringify(active)}, ${JSON.stringify(name)});
  writeFileSync(own, String(process.pid));
  await new Promise(resolve => { const ready = () => { if (existsSync(own + '.release')) { unwatchFile(own + '.release', ready); resolve(); } }; watchFile(own + '.release', {interval:10}, ready); ready(); });
  try { assert.ok(readdirSync(${JSON.stringify(active)}).filter(name => !name.endsWith('.release')).length <= 3, 'six GiB pool admits at most three two-GiB files'); ${name === 'first' ? "assert.fail('intentional admitted failure');" : ''} }
  finally { rmSync(own); }
});\n`);
  }
  const running = yield* run(['--suite=node', ...files], { CONCORD_GATE_MEMORY_MAX: String(7 * 1024 ** 3), CONCORD_TEST_CONCURRENCY: '8' }, root).pipe(Effect.forkScoped);
  const waitFor = (name: string) => Effect.gen(function*() { while (!(yield* fs.exists(join(active, name)))) yield* Effect.sleep('10 millis'); }).pipe(Effect.timeout('15 seconds'));
  for (const name of ['first', 'second', 'third']) yield* waitFor(name);
  assert.equal(yield* fs.exists(join(active, 'fourth')), false, 'an explicit concurrency of eight must not bypass the six-GiB pool');
  const firstPid = Number(yield* fs.readFileString(join(active, 'first')));
  yield* fs.writeFileString(join(active, 'first.release'), 'release');
  yield* waitFor('fourth');
  assert.throws(() => process.kill(firstPid, 0), { code: 'ESRCH' }, 'successor starts only after the failed predecessor exits');
  for (const name of ['second', 'third', 'fourth']) yield* fs.writeFileString(join(active, `${name}.release`), 'release');
  const result = yield* Fiber.join(running);
  assert.equal(result.code, 1, result.text);
  assert.match(result.text, /intentional admitted failure/u);
  const timings = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({file: Schema.String, cases: Schema.Number}))))(yield* fs.readFileString(join(result.output, 'file-timings.json')));
  assert.deepEqual(timings.map(row => row.file).sort(), [...files].sort());
  assert.equal(timings.reduce((sum, row) => sum + row.cases, 0), 4);
  assert.deepEqual((yield* fs.readDirectory(active)).filter(name => !name.endsWith('.release')), []);
  const peaks = (yield* fs.readFileString(join(result.output, 'process-tree-peaks.jsonl'))).trim().split('\n').map(line => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({file: Schema.String, budgetBytes: Schema.Number, state: Schema.String})))(line));
  assert.deepEqual(peaks.map(row => row.file).sort(), [...files].sort());
  for (const row of peaks) { assert.equal(row.budgetBytes, 2 * 1024 ** 3); assert.equal(row.state, process.platform === 'linux' ? 'observed' : 'unavailable'); }
}));

// @feature docs/engineering/testing/cli.md#并发
runnerTest('file admission waits for normal process exit after the official summary', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const file = join(root, 'normal-exit.test.ts'), saved = join(root, 'normal-exit');
  yield* fs.writeFileString(file, `import test from 'node:test'; import {writeFileSync} from 'node:fs';
process.once('beforeExit', () => { setImmediate(() => writeFileSync(${JSON.stringify(saved)}, 'normally drained')); });
test('official summary precedes final process drain', () => {});\n`);
  const result = yield* run(['--suite=node', file], {}, root);
  assert.equal(result.code, 0, result.text);
  assert.equal(yield* fs.readFileString(saved), 'normally drained');
  assert.doesNotMatch(result.text, /GateProcessCleanupFailed/u);
}));

// @feature docs/engineering/testing/cli.md#并发
runnerTest('seven GiB pool never overlaps packaging with a browser even when both overrides permit it', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const browser = join(root, 'route.e2e.ts'), packaging = join(root, 'test/process/release-package.test.ts');
  const browserStarted = join(root, 'browser-started'), packageStarted = join(root, 'package-started');
  yield* fs.makeDirectory(join(root, 'test/process'), { recursive: true });
  yield* fs.writeFileString(browser, 'export {};\n');
  const waitSource = (marker: string) => `await new Promise(resolve => { const ready = () => { if (existsSync(${JSON.stringify(marker + '.release')})) { unwatchFile(${JSON.stringify(marker + '.release')}, ready); resolve(); } }; watchFile(${JSON.stringify(marker + '.release')}, {interval:10}, ready); ready(); });`;
  yield* fs.writeFileString(packaging, `import test from 'node:test'; import assert from 'node:assert/strict'; import {existsSync,writeFileSync,watchFile,unwatchFile} from 'node:fs';
test('admitted packaging', async () => { assert.equal(existsSync(${JSON.stringify(browserStarted)}) && !existsSync(${JSON.stringify(browserStarted + '.done')}), false); writeFileSync(${JSON.stringify(packageStarted)}, 'started'); ${waitSource(packageStarted)} writeFileSync(${JSON.stringify(packageStarted + '.done')}, 'done'); });\n`);
  const pnpm = join(root, 'pnpm');
  yield* fs.writeFileString(pnpm, `#!/usr/bin/env node
import assert from 'node:assert/strict'; import {existsSync,writeFileSync,watchFile,unwatchFile} from 'node:fs';
assert.equal(existsSync(${JSON.stringify(packageStarted)}) && !existsSync(${JSON.stringify(packageStarted + '.done')}), false);
assert.equal(process.argv[process.argv.indexOf('--workers')+1], '1');
writeFileSync(${JSON.stringify(browserStarted)}, 'started'); ${waitSource(browserStarted)} writeFileSync(${JSON.stringify(browserStarted + '.done')}, 'done');\n`);
  yield* fs.chmod(pnpm, 0o755);
  const running = yield* run([packaging, browser], {
    PATH: `${root}:${process.env.PATH}`, CONCORD_TEST_PACKAGE_ROOT: join(root, 'archive'),
    CONCORD_TEST_CONCURRENCY: '8', CONCORD_E2E_WORKERS: '4', CONCORD_GATE_MEMORY_MAX: String(7 * 1024 ** 3),
  }, root).pipe(Effect.forkScoped);
  const waitFor = (paths: string[]) => Effect.gen(function*() {
    for (;;) { for (const path of paths) if (yield* fs.exists(path)) return path; yield* Effect.sleep('10 millis'); }
  }).pipe(Effect.timeout('15 seconds'));
  const first = yield* waitFor([browserStarted, packageStarted]);
  const second = first === browserStarted ? packageStarted : browserStarted;
  assert.equal(yield* fs.exists(second), false, 'five plus four GiB cannot enter a six-GiB pool together');
  yield* fs.writeFileString(first + '.release', 'release');
  yield* waitFor([second]);
  assert.equal(yield* fs.exists(first + '.done'), true);
  yield* fs.writeFileString(second + '.release', 'release');
  const result = yield* Fiber.join(running);
  assert.equal(result.code, 0, result.text);
  assert.match(result.text, /e2e workers=1/u);
}));
