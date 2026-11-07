import assert from 'node:assert/strict';
import { NodeServices } from '@effect/platform-node';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import type { Scope} from 'effect';
import { Deferred, Duration, Effect, Fiber, FileSystem, Schema, Stream } from 'effect';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { tmpdir } from '../support/temporary.ts';
import { gateAdmissionHistoryPath } from '../../scripts/gate-admission-history.ts';
import { GiB } from '../../scripts/gate-resources.ts';
import { observeFixedGateMemory, observeTestProcessTree } from '../../scripts/gate-resource-processes.ts';
import { readTestTimingReport } from '../../scripts/gate-timings.ts';

type Requirements = FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | Scope.Scope;
const runnerTest = (name: string, body: (root: string) => Effect.Effect<void, unknown, Requirements>) =>
  test(name, { timeout: 45_000 }, () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-runner-' });
    yield* body(root);
  })).pipe(Effect.provide(NodeServices.layer))));

const run = Effect.fn('test.runner.integration')(function*(args: string[], env: Record<string, string | undefined> = {}, cwd?: string, onOutput?: (chunk: string) => void) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make('node', [resolve('scripts/test-built.ts'), ...args], {
    env: { ...process.env, CONCORD_TEST_TIMINGS: undefined, CONCORD_TEST_COMPILE_CACHE: undefined, ...env },
    cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  }));
  const [text, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(child.all).pipe(Stream.tap(chunk => Effect.sync(() => onOutput?.(chunk))))), child.exitCode], { concurrency: 'unbounded' });
  const output = /# Test diagnostics: ([^\n]+)/u.exec(text)?.[1];
  assert.ok(output, text);
  return { text, code: Number(code), output };
});

const Counts = Schema.Struct({ tests: Schema.Number, failed: Schema.Number, cancelled: Schema.Number, skipped: Schema.Number });
const Timing = Schema.Struct({ scope: Schema.String, counts: Counts });

// @feature docs/engineering/testing/cli.md#并发
runnerTest('fixed overhead counts shared controllers and excludes only admitted process identities', () => Effect.gen(function*() {
  if (process.platform !== 'linux') return;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fixed = yield* observeFixedGateMemory(2 * GiB);
  const admitted = yield* observeTestProcessTree('owned-memory', 2 * GiB, ['owned-memory']);
  const children = [];
  for (const [name, size] of [['shared-controller', 32], ['owned-memory', 64]] as const) {
    const child = yield* spawner.spawn(ChildProcess.make(process.execPath, ['-e', `const bytes=Buffer.alloc(${size}*1024*1024, 1); process.stdout.write('ready'); setInterval(()=>{bytes[0]++;},1000);`, name], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }));
    yield* Stream.runHead(Stream.decodeText(child.stdout));
    if (name === 'owned-memory') yield* admitted.register(Number(child.pid));
    children.push(child);
  }
  // The admitted observer's final scan and normal-exit barrier are exercised too.
  yield* Effect.sleep('150 millis');
  for (const child of children) yield* child.kill();
  const owned = yield* admitted.finish;
  assert.ok(owned.processes.length > 0);
  const all = yield* fixed.finish([], true);
  const excluded = yield* fixed.finish(owned.processes, true);
  const reusedPid = yield* fixed.finish(owned.processes.map(row => ({ ...row, birth: `${row.birth}-different` })), true);
  assert.ok(all.peakBytes! - excluded.peakBytes! > 48 * 1024 ** 2, JSON.stringify({ all, excluded }));
  assert.equal(reusedPid.peakBytes, all.peakBytes, 'PID alone must not transfer ownership');
  assert.ok(excluded.peakBytes! > 32 * 1024 ** 2, 'shared controller and supervisor remain charged');
  const incomplete = yield* fixed.finish(owned.processes, false);
  assert.equal(incomplete.state, 'unknown');
  assert.equal(incomplete.peakBytes, null);
}));

// @feature docs/engineering/testing/cli.md#并发
runnerTest('real cold and warm file runs use the previous PSS peak while keeping the two GiB reporting budget', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const file = join(root, 'history.test.ts'), cache = join(root, 'cache');
  yield* fs.writeFileString(file, `import test from 'node:test'; test('sampled file', () => {});\n`);
  const env = { XDG_CACHE_HOME: cache, CONCORD_GATE_MEMORY_MAX: String(7 * GiB) };
  const Peak = Schema.Struct({ file: Schema.String, budgetBytes: Schema.Number, admittedBytes: Schema.Number, peakBytes: Schema.NullOr(Schema.Number), state: Schema.String });
  const cold = yield* run(['--suite=node', file], env, root);
  assert.equal(cold.code, 0, cold.text);
  const timingReport = yield* readTestTimingReport(cold.output);
  assert.ok(timingReport, 'the persisted admission budgets must decode into the gate report');
  assert.equal(timingReport.admission?.budgets.browser, 2.5 * GiB);
  const coldPeak = Schema.decodeUnknownSync(Schema.fromJsonString(Peak))((yield* fs.readFileString(join(cold.output, 'process-tree-peaks.jsonl'))).trim());
  assert.equal(coldPeak.admittedBytes, 2 * GiB);
  assert.equal(coldPeak.budgetBytes, 2 * GiB);
  const record = gateAdmissionHistoryPath(file, join(cache, 'concord/gate-admission'));
  if (process.platform === 'linux') {
    assert.equal(coldPeak.state, 'observed');
    const stored = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ file: Schema.String, peakBytes: Schema.Number })))(yield* fs.readFileString(record));
    assert.equal(stored.file, file);
    assert.equal(stored.peakBytes, coldPeak.peakBytes);
  }
  const warm = yield* run(['--suite=node', file], env, root);
  assert.equal(warm.code, 0, warm.text);
  const warmPeak = Schema.decodeUnknownSync(Schema.fromJsonString(Peak))((yield* fs.readFileString(join(warm.output, 'process-tree-peaks.jsonl'))).trim());
  assert.equal(warmPeak.budgetBytes, 2 * GiB);
  assert.equal(warmPeak.admittedBytes, coldPeak.peakBytes === null ? 2 * GiB : Math.max(GiB / 2, Math.ceil(coldPeak.peakBytes / (GiB / 2)) * (GiB / 2)));
  console.error(`# History admission: cold=${coldPeak.admittedBytes}; coldPeakPss=${coldPeak.peakBytes}; warm=${warmPeak.admittedBytes}; warmPeakPss=${warmPeak.peakBytes}; reportingBudget=${warmPeak.budgetBytes}`);
  if (process.platform === 'linux') {
    yield* fs.writeFileString(record, '{broken');
    const broken = yield* run(['--suite=node', file], env, root);
    assert.equal(broken.code, 1, broken.text);
    assert.match(broken.text, /GateAdmissionHistoryInvalid/u);
    assert.doesNotMatch(broken.text, /\(pass\) sampled file/u);
  }
}));

// @feature docs/engineering/testing/README.md#检查入口
runnerTest('all Bun layers and their typed children run source without a package or V8 compile cache', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const bunVersion = (yield* fs.readFileString(resolve('.bun-version'))).trim();
  const source = join(root, 'test/model/source.test.ts'), cli = join(root, 'test/cli/source.test.ts');
  const child = join(root, 'typed-child.ts');
  const cacheHome = join(root, 'shared-cache'), compileCache = join(cacheHome, 'concord/node-compile');
  yield* fs.makeDirectory(join(root, 'test/model'), { recursive: true });
  yield* fs.makeDirectory(join(root, 'test/cli'), { recursive: true });
  yield* fs.writeFileString(child, `const value: number = 42; console.log(JSON.stringify({value, bun: process.versions.bun, options: process.env.NODE_OPTIONS, cache: process.env.NODE_COMPILE_CACHE}));\n`);
  for (const file of [source, cli]) yield* fs.writeFileString(file, `import test from 'node:test'; import assert from 'node:assert/strict'; import { spawnSync } from 'node:child_process';
test('source uses native type erasure', () => {
  assert.equal(process.versions.bun, ${JSON.stringify(bunVersion)});
  assert.ok(process.execArgv.every(arg => !arg.includes('tsx')));
  const child = spawnSync(process.execPath, [${JSON.stringify(child)}], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.value, 42);
  assert.match(result.options, /--conditions=concord-source/u);
  assert.doesNotMatch(result.options, /tsx/u);
  assert.equal(result.bun, process.versions.bun);
  assert.equal(result.cache, undefined);
});\n`);
  const env = { NODE_OPTIONS: '', XDG_CACHE_HOME: cacheHome };
  const result = yield* run(['--suite=node', source, cli], env, root);
  assert.equal(result.code, 0, result.text);
  assert.match(result.text, /# Source Bun tests:/u);
  assert.doesNotMatch(result.text, /# Installed Bun tests:/u);
  const timings = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({ file: Schema.String }))))(yield* fs.readFileString(join(result.output, 'file-timings.json')));
  assert.deepEqual(timings.map(timing => timing.file).sort(), [source, cli].sort());
  assert.equal(yield* fs.exists(compileCache), false);
  const sentinel = join(cacheHome, 'retained');
  yield* fs.writeFileString(sentinel, 'unrelated cache survives runner lifetime');
  const again = yield* run(['--suite=node', source, cli], env, root);
  assert.equal(again.code, 0, again.text);
  assert.equal(yield* fs.readFileString(sentinel), 'unrelated cache survives runner lifetime');
  assert.equal(yield* fs.exists(compileCache), false);
}));

// @feature docs/engineering/build/architecture.md#脚本只写项目特有的规则
runnerTest('cancelling gate reaps static task groups and fixture scratch without creating a V8 cache', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const record = Schema.fromJsonString(Schema.Struct({ pid: Schema.Number, cache: Schema.optional(Schema.String), cgroup: Schema.String, packageRoot: Schema.optional(Schema.String), fixtureRoot: Schema.optional(Schema.String), task: Schema.String }));
  const fakeVp = join(root, 'vp.ts');
  yield* fs.writeFileString(fakeVp, `#!/usr/bin/env node
import { writeFileSync, readFileSync } from 'node:fs';
process.on('SIGTERM', () => {});
const task = process.argv.find(value => /^(?:gate:|test:)/.test(value)) ?? 'build';
writeFileSync(${JSON.stringify(root)} + '/' + task + '.json', JSON.stringify({task, pid: process.pid, cache: process.env.CONCORD_TEST_COMPILE_CACHE, fixtureRoot: process.env.TMPDIR, cgroup: process.platform === 'linux' ? readFileSync('/proc/self/cgroup', 'utf8') : ''}));
console.log('TASK_READY');
setInterval(() => {}, 1000);
`);
  yield* fs.chmod(fakeVp, 0o755);
  yield* fs.symlink(fakeVp, join(root, 'vp'));
  // Keep a failed cleanup regression from leaking the deliberately stubborn boundary.
  yield* Effect.addFinalizer(() => Effect.gen(function*() {
    for (const file of (yield* fs.readDirectory(root)).filter(file => file.endsWith('.json'))) {
      const { pid } = Schema.decodeUnknownSync(record)(yield* fs.readFileString(join(root, file)));
      yield* Effect.sync(() => { try { process.kill(-pid, 'SIGKILL'); } catch {} });
    }
  }).pipe(Effect.orDie));
  const child = yield* spawner.spawn(ChildProcess.make('node', [resolve('scripts/gate.ts'), 'test/model/test-reporter.test.ts'], {
    env: { ...process.env, CONCORD_GATE_SCOPE: undefined, CONCORD_GATE_REPORT: undefined, XDG_CACHE_HOME: join(root, 'shared-cache'), CONCORD_GATE_QUEUE_DIRECTORY: join(root, 'gate-queue'), PATH: `${root}:${process.env.PATH}` },
    stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', forceKillAfter: Duration.seconds(10),
  }));
  const ready = yield* Deferred.make<void>();
  let output = '';
  const drain = yield* Stream.runForEach(Stream.decodeText(child.all), text => Effect.gen(function*() {
    output += text;
    if (output.split('TASK_READY').length === 4) yield* Deferred.succeed(ready, undefined);
  })).pipe(Effect.forkScoped);
  yield* Deferred.await(ready).pipe(Effect.timeout(Duration.seconds(20)), Effect.catch(() => Effect.sync(() => assert.fail(`Gate tasks did not become ready:\n${output}`))));
  const processes = yield* Effect.forEach((yield* fs.readDirectory(root)).filter(file => file.endsWith('.json')), file => fs.readFileString(join(root, file)).pipe(Effect.map(Schema.decodeUnknownSync(record))));
  assert.equal(processes.length, 3);
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
    assert.equal(cache, undefined);
    assert.equal(yield* fs.exists(join(root, 'shared-cache/concord/node-compile')), false);
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

runnerTest('official Bun JUnit retains circular failure diagnostics and reaches its run summary', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const file = join(root, 'circular.test.ts');
  yield* fs.writeFileString(file, `import ${JSON.stringify(pathToFileURL(resolve('test/fixtures/reporter-circular-error.ts')).href)};\n`);
  const result = yield* run(['--suite=node', file]);
  assert.equal(result.code, 1, result.text);
  assert.doesNotMatch(result.text, /Converting circular structure|uncaughtException/u);
  assert.match(result.text, /\(fail\) intentional circular error fixture/u);
  const timings = (yield* fs.readFileString(join(result.output, 'node-timings.jsonl'))).trim().split('\n').map(line => Schema.decodeUnknownSync(Schema.fromJsonString(Timing))(line));
  const summary = timings.find(timing => timing.scope === 'run');
  assert.deepEqual(summary?.counts, { tests: 1, failed: 1, cancelled: 0, skipped: 0 });
  const diagnostic = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ name: Schema.String, error: Schema.String })))((yield* fs.readFileString(join(result.output, 'node-failures.jsonl'))).trim().split('\n')[0]);
  assert.match(diagnostic.error, /intentional circular reporter failure/u);
  assert.ok((yield* fs.readDirectory(join(result.output, 'node'))).some(name => name.startsWith('circular.test.ts-')));
  assert.equal(yield* fs.exists(join(result.output, 'node-compile-cache')), false);
}));

// @feature docs/engineering/testing/README.md#检查入口
runnerTest('name-filtered files count executed cases instead of successful file wrappers', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const excluded = join(root, 'excluded.test.ts'), selected = join(root, 'selected.test.ts');
  yield* fs.writeFileString(excluded, `import { describe, test } from 'node:test'; describe('excluded suite', () => { test('excluded case', () => { throw new Error('unselected body ran'); }); });\n`);
  yield* fs.writeFileString(selected, `import test from 'node:test'; test('selected case', () => {});\n`);
  for (const files of [[excluded], [excluded, selected]]) {
    const result = yield* run(['--suite=node', '--test-name-pattern=^selected case$', ...files], {}, root);
    assert.equal(result.code, 0, result.text);
    const expected = files.length - 1;
    assert.doesNotMatch(result.text, /ok \d+ - .*excluded\.test\.ts/u);
    const timings = (yield* fs.readFileString(join(result.output, 'node-timings.jsonl'))).trim().split('\n')
      .map(line => Schema.decodeUnknownSync(Schema.fromJsonString(Timing))(line));
    assert.deepEqual(timings.find(timing => timing.scope === 'run')?.counts, { tests: expected, failed: 0, cancelled: 0, skipped: 1 });
    const cases = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({ cases: Schema.Number }))))(
      yield* fs.readFileString(join(result.output, 'file-timings.json')),
    );
    assert.equal(cases.reduce((sum, file) => sum + file.cases, 0), expected);
  }
}));

runnerTest('official name filtering and shard union select each requested source test exactly once', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const bunVersion = (yield* fs.readFileString(resolve('.bun-version'))).trim();
  const files: string[] = [];
  for (const name of ['alpha', 'beta', 'gamma']) {
    const file = join(root, `${name}.test.ts`);
    yield* fs.writeFileString(file, `import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('selected ${name}', () => { assert.equal(process.versions.bun, ${JSON.stringify(bunVersion)}); assert.equal(process.env.CONCORD_TEST_FILE_ID, ${JSON.stringify(file)}); });\ntest('excluded ${name}', () => assert.fail('name filter was lost'));\n`);
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
  assert.match(result.text, /\(pass\) discovered source fixture/u);
  assert.doesNotMatch(result.text, /not a test file/u);
  const pid = Schema.decodeUnknownSync(Schema.NumberFromString)(yield* fs.readFileString(pidFile));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}));

runnerTest('Bun and browser failures leave the other suite running and retain official browser arguments', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString(join(root, 'package.json'), JSON.stringify({ private: true }));
  const browser = join(root, 'route.e2e.ts'), node = join(root, 'route.test.ts');
  const browserArgs = join(root, 'browser-args.json'), nodeDone = join(root, 'node-done');
  yield* fs.writeFileString(browser, 'export {};\n');
  const fakeVp = join(root, 'vp.ts');
  yield* fs.writeFileString(fakeVp, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nsetTimeout(() => { writeFileSync(${JSON.stringify(browserArgs)}, JSON.stringify(process.argv.slice(2))); console.log('BROWSER_EXECUTED'); process.exitCode = Number(process.env.BROWSER_EXIT); }, 150);\n`);
  yield* fs.chmod(fakeVp, 0o755);
  yield* fs.symlink(fakeVp, join(root, 'vp'));
  const env = { PATH: `${root}:${process.env.PATH}`, CONCORD_GATE_MEMORY_MAX: String(7 * GiB), CONCORD_E2E_WORKERS: '2' };
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
  assert.match(browserFailed.text, /\(pass\) selected/u);
}));

runnerTest('cancelling the source runner reaps test processes and descendants that ignore SIGTERM', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const file = join(root, 'cancel.test.ts'), pids = join(root, 'pids.json');
  yield* fs.writeFileString(file, `import { spawn } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\nimport test from 'node:test';\nprocess.on('SIGTERM', () => {});\nconst child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); process.stdout.write("READY"); setInterval(()=>{},1000)'], {stdio:['ignore','pipe','ignore']});\nchild.stdout.once('data', () => { writeFileSync(${JSON.stringify(pids)}, JSON.stringify([process.ppid, process.pid, child.pid])); console.log('FIXTURE_READY'); });\ntest('hang until cancelled', () => new Promise(()=>{setInterval(()=>{},1000)}));\n`);
  const child = yield* spawner.spawn(ChildProcess.make('node', ['scripts/test-built.ts', '--suite=node', file], {
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
  try { assert.ok(readdirSync(${JSON.stringify(active)}).filter(name => !name.endsWith('.release')).length <= 2, 'five GiB pool admits at most two cold two-GiB files'); ${name === 'first' ? "assert.fail('intentional admitted failure');" : ''} }
  finally { rmSync(own); }
});\n`);
  }
  let output = '';
  const running = yield* run(['--suite=node', ...files], { CONCORD_GATE_MEMORY_MAX: String(7 * 1024 ** 3), CONCORD_TEST_CONCURRENCY: '8', XDG_CACHE_HOME: join(root, 'cold-cache') }, root, chunk => { output += chunk; }).pipe(Effect.forkScoped);
  const waitForActive = (count: number, excluded: readonly string[] = []) => Effect.gen(function*() {
    for (;;) {
      const names = (yield* fs.exists(active)) ? (yield* fs.readDirectory(active)).filter(name => !name.endsWith('.release') && !excluded.includes(name)) : [];
      if (names.length >= count) return names;
      yield* Effect.sleep('10 millis');
    }
  }).pipe(Effect.timeout('15 seconds'), Effect.tapError(() => Effect.sync(() => console.error(`Admission fixture output: ${output}`))));
  // History lookup is asynchronous; admission does not promise argument order.
  const initial = yield* waitForActive(2);
  assert.equal(initial.length, 2, 'an explicit concurrency of eight must not bypass the five-GiB pool');
  const predecessor = initial.includes('first') ? 'first' : initial[0]!;
  const predecessorPid = Number(yield* fs.readFileString(join(active, predecessor)));
  yield* fs.writeFileString(join(active, `${predecessor}.release`), 'release');
  const next = yield* waitForActive(1, initial);
  assert.throws(() => process.kill(predecessorPid, 0), { code: 'ESRCH' }, 'successor starts only after the predecessor exits');
  for (const name of [...initial.filter(name => name !== predecessor), ...next]) yield* fs.writeFileString(join(active, `${name}.release`), 'release');
  const final = yield* waitForActive(1, [...initial, ...next]);
  for (const name of final) yield* fs.writeFileString(join(active, `${name}.release`), 'release');
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
  yield* fs.writeFileString(file, `import test from 'node:test'; import {spawn} from 'node:child_process';
const child = spawn('node', ['-e', ${JSON.stringify(`setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(saved)}, 'normally drained'), 200);`)}], {stdio:'ignore'});
child.unref();
test('official summary precedes final process drain', () => {});\n`);
  const result = yield* run(['--suite=node', file], {}, root);
  assert.equal(result.code, 0, result.text);
  assert.equal(yield* fs.readFileString(saved), 'normally drained');
  assert.doesNotMatch(result.text, /GateProcessCleanupFailed/u);
}));
