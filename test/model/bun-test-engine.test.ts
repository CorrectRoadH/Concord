import assert from 'node:assert/strict';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Duration, Effect, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBunCases, readBunCompletion } from '../../scripts/bun-test-report.ts';
import { tmpdir } from '../support/temporary.ts';
import { observeOwnedProcessGroup } from '../../src/base/process/owned-process.ts';
import { ProcessEvent } from '../../src/base/process/process-events.ts';

// @feature docs/engineering/testing/architecture.md#bun-测试引擎
// @issue docs/issues/bun-junit-ci-properties.md
test('official Bun CI metadata preserves case counts and failure ownership', () => {
  const file = resolve('test/model/fixture.test.ts');
  const properties = '<properties><property name="ci" value="https://github.com/CorrectRoadH/Concord/actions/runs/42362038518"/><property name="commit" value="a88230cbcc657466022005dcc57b2a998564b306"/></properties>';
  const xml = `<testsuites name="bun test" tests="2" assertions="0" failures="1" skipped="1" time="0.1"><testsuite file="${file}">${properties}<testcase file="${file}" name="filtered"><skipped/></testcase><testcase file="${file}" name="failed"><failure message="bad">bad</failure></testcase></testsuite></testsuites>`;
  assert.deepEqual(readBunCases(xml, file, process.cwd()), { counts: { tests: 1, failed: 1, cancelled: 0, skipped: 1 }, failures: [{ name: 'failed', error: 'bad' }] });
  for (const invalid of [xml.replace('name="ci"', 'unknown="ci"'), xml.replace('name="ci"', 'name="ci" extra="x"'), xml.replace('<property name="commit"', '<testcase name="commit"')]) {
    assert.throws(() => readBunCases(invalid, file, process.cwd()));
  }
});

// @feature docs/engineering/testing/architecture.md#bun-测试引擎
test('Bun startup failure reaches the controller failure report without inventing case counts', { timeout: 20_000 }, () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-bun-spawn-failure-' });
  const executable = join(root, 'bun'), file = join(root, 'unstarted.test.ts');
  yield* fs.writeFileString(file, `throw Error('TEST_MUST_NOT_START');`);
  const pinned = (yield* fs.readFileString(fileURLToPath(new URL('../../.bun-version', import.meta.url)))).trim();
  // The external executable disappears after a successful version check, exercising real ENOENT.
  yield* fs.writeFileString(executable, `#!${process.execPath}\nimport {unlinkSync} from 'node:fs'; unlinkSync(process.argv[1]); console.log(${JSON.stringify(pinned)});\n`);
  yield* fs.chmod(executable, 0o755);
  const child = yield* spawner.spawn(ChildProcess.make(process.execPath, ['--no-env-file', '--config=/dev/null', resolve('scripts/test-built.ts'), file], {
    cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, PATH: root, CONCORD_TEST_TIMINGS: undefined },
  }));
  const [text, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(child.all)), child.exitCode], { concurrency: 'unbounded' });
  assert.equal(Number(code), 1, text);
  assert.doesNotMatch(text, /TEST_MUST_NOT_START/u);
  const output = /# Test diagnostics: ([^\n]+)/u.exec(text)?.[1];
  assert.ok(output, text);
  assert.match(yield* fs.readFileString(join(output, 'node-failures.jsonl')), /Bun test engine/u);
  const rows = (yield* fs.readFileString(join(output, 'node-timings.jsonl'))).trim().split('\n')
    .map(line => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ scope: Schema.String, success: Schema.Boolean, counts: Schema.NullOr(Schema.Unknown) })))(line));
  assert.ok(rows.some(row => row.scope === 'run' && !row.success && row.counts === null));
})).pipe(Effect.provide(NodeServices.layer))));

// @feature docs/engineering/testing/architecture.md#bun-测试引擎
test('official Bun report boundaries reject damaged, mismatched and unexpected completion records', () => {
  const file = resolve('test/model/fixture.test.ts');
  assert.equal(readBunCompletion(JSON.stringify({ version: 1, files: { [file]: 0 } }), file, process.cwd()), 0);
  for (const text of ['{broken', '{}', JSON.stringify({ version: 1, files: {} }),
    JSON.stringify({ version: 1, files: { [file]: -1 } }),
    JSON.stringify({ version: 1, files: { [file]: 1, 'unexpected.test.ts': 1 } })]) {
    assert.throws(() => readBunCompletion(text, file, process.cwd()));
  }
  const xml = `<testsuites name="bun test" tests="2" assertions="0" failures="1" skipped="1" time="0.1"><testsuite file="${file}"><testcase file="${file}" name="filtered"><skipped/></testcase><testcase file="${file}" name="parent &amp; child"><failure message="bad">bad &lt;value&gt;</failure></testcase></testsuite></testsuites>`;
  assert.deepEqual(readBunCases(xml, file, process.cwd()), { counts: { tests: 1, failed: 1, cancelled: 0, skipped: 1 }, failures: [{ name: 'parent & child', error: 'bad <value>' }] });
  for (const damaged of [xml.replace('tests="2"', 'tests="3"'), xml.replace('</testcase>', ''), xml.replaceAll(file, '/unexpected.test.ts'), '<!DOCTYPE x>' + xml]) {
    assert.throws(() => readBunCases(damaged, file, process.cwd()));
  }
  assert.equal(readBunCases(xml.replace('>bad &lt;value&gt;</failure>', '></failure>').replace('message="bad"', 'message="&amp;amp;"'), file, process.cwd()).failures[0]?.error, '&amp;');
});

// @feature docs/engineering/testing/architecture.md#bun-测试引擎
test('Bun engine requires fresh completion receipts and reports empty and filtered files as zero executions', { timeout: 45_000 }, () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-bun-completion-' });
  const files = [join(root, 'pass.test.ts'), join(root, 'empty.test.ts'), join(root, 'import.test.ts')];
  yield* fs.writeFileString(files[0]!, `import test from 'node:test'; test('real case',()=>{});`);
  yield* fs.writeFileString(files[1]!, 'export {};');
  yield* fs.writeFileString(files[2]!, `throw Error('IMPORT_FAILURE');`);
  const run = (selected: readonly string[], args: string[] = []) => Effect.scoped(Effect.gen(function*() {
    const child = yield* spawner.spawn(ChildProcess.make(process.execPath, ['--no-env-file', '--config=/dev/null', resolve('scripts/test-built.ts'), ...args, ...selected], {
      cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
      env: { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: 'fixture', GITHUB_REPOSITORY: 'example/fixture', GITHUB_SHA: 'fixture', CONCORD_TEST_TIMINGS: undefined, CONCORD_TEST_FILE_ID: undefined, CONCORD_TEST_EVENT_DIRECTORY: undefined, CONCORD_TEST_RUN_ID: undefined },
    }));
    const [text, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(child.all)), child.exitCode], { concurrency: 'unbounded' });
    const output = /# Test diagnostics: ([^\n]+)/u.exec(text)?.[1];
    assert.ok(output, text);
    return { code: Number(code), text, output };
  }));
  const passed = yield* run(files.slice(0, 2));
  assert.equal(passed.code, 0, passed.text);
  const timings = (output: string) => fs.readFileString(join(output, 'file-timings.json')).pipe(Effect.map(text => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({ file: Schema.String, success: Schema.Boolean, cases: Schema.optional(Schema.Number) }))))(text)));
  const initial = new Map((yield* timings(passed.output)).map(row => [row.file, row.cases]));
  assert.equal(initial.get(files[0]!), 1);
  assert.equal(initial.get(files[1]!), 0);
  const context = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ run: Schema.String, directory: Schema.String })))(yield* fs.readFileString(join(passed.output, 'process-event-run.json')));
  const events = (yield* Effect.forEach(yield* fs.readDirectory(context.directory), name => fs.readFileString(join(context.directory, name))))
    .flatMap(text => text.trim().split('\n').filter(Boolean).map(line => Schema.decodeUnknownSync(Schema.fromJsonString(ProcessEvent))(line)))
    .filter(row => row.run === context.run);
  assert.ok(events.some(row => row.kind === 'coverage-start' && row.file === files[0]));
  assert.ok(events.some(row => row.kind === 'coverage-end' && row.file === files[0] && row.healthy === false));
  assert.ok(events.some(row => row.kind === 'unknown' && row.file === files[0]));
  // A previous successful file must not authorize the same path's early zero exit.
  yield* fs.writeFileString(files[0]!, `import test from 'node:test'; test('early zero',()=>process.exit(0));`);
  const early = yield* run([files[0]!, files[2]!]);
  assert.equal(early.code, 1, early.text);
  assert.match(early.text, /timings\.json/u);
  assert.match(early.text, /IMPORT_FAILURE/u);
  assert.deepEqual((yield* timings(early.output)).map(row => row.success), [false, false]);
  const filtered = yield* run([files[0]!], ['--test-name-pattern=does-not-match']);
  assert.equal(filtered.code, 0, filtered.text);
  assert.deepEqual((yield* timings(filtered.output)).map(row => row.cases), [0]);
})).pipe(Effect.provide(NodeServices.layer))));

// @feature docs/engineering/testing/architecture.md#bun-测试引擎
test('Bun engine ignores cwd dotenv and bunfig and preserves nested failure ownership', { timeout: 20_000 }, () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-bun-config-' });
  const file = join(root, 'isolation.test.ts');
  yield* fs.writeFileString(join(root, '.env'), 'CONCORD_BUN_DOTENV_MUST_NOT_LOAD=wrong\n');
  yield* fs.writeFileString(join(root, 'bunfig.toml'), '[test]\npreload=["./missing-preload.ts"]\n');
  yield* fs.writeFileString(file, `import test from 'node:test'; import assert from 'node:assert/strict'; test('parent',async t=>{assert.equal(process.env.CONCORD_BUN_DOTENV_MUST_NOT_LOAD,undefined); await t.test('child',()=>assert.fail('NESTED_FAILURE'));});`);
  const child = yield* spawner.spawn(ChildProcess.make(process.execPath, ['--no-env-file', '--config=/dev/null', resolve('scripts/test-built.ts'), file], {
    cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, CONCORD_BUN_DOTENV_MUST_NOT_LOAD: undefined, CONCORD_TEST_TIMINGS: undefined },
  }));
  const [text, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(child.all)), child.exitCode], { concurrency: 'unbounded' });
  assert.equal(Number(code), 1, text);
  assert.match(text, /NESTED_FAILURE/u);
  assert.doesNotMatch(text, /missing-preload|wrong/u);
  const output = /# Test diagnostics: ([^\n]+)/u.exec(text)?.[1];
  assert.ok(output, text);
  const timings = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({ cases: Schema.Number }))))(yield* fs.readFileString(join(output, 'file-timings.json')));
  assert.deepEqual(timings.map(row => row.cases), [1]);
})).pipe(Effect.provide(NodeServices.layer))));

// @feature docs/engineering/testing/architecture.md#bun-测试引擎
test('Bun process deadline reaps a reparented grandchild in its owned group before returning', { timeout: 25_000, skip: process.platform === 'win32' }, () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-bun-deadline-' });
  const file = join(root, 'orphan.test.ts'), pidFile = join(root, 'orphan-pid'), groupFile = join(root, 'group-pid');
  // The intermediate parent exits immediately; its child is no longer reachable via /proc/root/children.
  const grandchild = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`;
  const intermediate = `const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore'});c.unref();`;
  yield* fs.writeFileString(file, `import {spawn} from 'node:child_process'; import {existsSync,writeFileSync} from 'node:fs'; import test from 'node:test'; writeFileSync(${JSON.stringify(groupFile)},String(process.pid)); const c=spawn(process.execPath,['-e',${JSON.stringify(intermediate)}],{stdio:'ignore'}); c.unref(); test('wait for grandchild',async()=>{while(!existsSync(${JSON.stringify(pidFile)})) await new Promise(r=>setTimeout(r,5));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);await new Promise(()=>{});});`);
  const runner = join(root, 'controller.ts');
  yield* fs.writeFileString(runner, `import {runNodeTests} from ${JSON.stringify(new URL('../../scripts/test-reporter.ts', import.meta.url).href)}; import {Effect} from ${JSON.stringify(import.meta.resolve('effect'))}; import {NodeServices,NodeRuntime} from ${JSON.stringify(import.meta.resolve('@effect/platform-node'))}; runNodeTests({files:[${JSON.stringify(file)}],concurrency:1,timeout:10000},${JSON.stringify(join(root, 'output'))}).pipe(Effect.tap(failed=>Effect.sync(()=>{process.exitCode=failed?1:0})),Effect.scoped,Effect.provide(NodeServices.layer),NodeRuntime.runMain);`);
  const child = yield* spawner.spawn(ChildProcess.make(process.execPath, ['--no-env-file', '--config=/dev/null', runner], { cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', forceKillAfter: Duration.seconds(5) }));
  const [text, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(child.all)), child.exitCode], { concurrency: 'unbounded' });
  assert.equal(Number(code), 1, text);
  const pid = Number(yield* fs.readFileString(pidFile));
  const group = Number(yield* fs.readFileString(groupFile));
  assert.ok(['gone', 'zombie-only'].includes(observeOwnedProcessGroup(group)), text);
  // An init-owned zombie has exited and has no resources, even before init reaps its PID.
  if (process.platform === 'linux' && (yield* fs.exists(`/proc/${pid}/stat`))) assert.match(yield* fs.readFileString(`/proc/${pid}/stat`), /\) [ZX] /u);
  else assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
})).pipe(Effect.provide(NodeServices.layer))));
