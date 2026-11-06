import assert from 'node:assert/strict';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GiB } from '../../scripts/gate-resources.js';
import { tmpdir } from '../support/temporary.js';

const Report = Schema.Struct({
  memoryIsolation: Schema.String, reason: Schema.NullOr(Schema.String),
  memoryMaxBytes: Schema.Number, memorySwapMaxBytes: Schema.NullOr(Schema.Number),
  memoryPeakBytes: Schema.NullOr(Schema.Number), memorySwapPeakBytes: Schema.NullOr(Schema.Number),
  cgroup: Schema.NullOr(Schema.String), unit: Schema.NullOr(Schema.String), exitCode: Schema.NullOr(Schema.Number),
});

const resourceTest = (name: string, body: (root: string) => Effect.Effect<void, unknown, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | import('effect').Scope.Scope>) =>
  test(name, { timeout: 30_000 }, () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-gate-resources-' });
    yield* body(root);
  })).pipe(Effect.provide(NodeServices.layer))));

const hasSystemdScope = Effect.gen(function*() {
  if (process.platform !== 'linux') return false;
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists('/sys/fs/cgroup/cgroup.controllers'))) return false;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* spawner.exitCode(ChildProcess.make('systemctl', ['--user', 'show-environment'], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })).pipe(
    Effect.map(code => Number(code) === 0), Effect.catch(() => Effect.succeed(false)),
  );
});

const runFixture = Effect.fn('test.gate.resources')(function*(root: string, body: string, memoryMaxBytes: number, noSystemd = false) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fixture = join(root, 'fixture.ts');
  const reportRoot = join(root, 'reports');
  yield* fs.writeFileString(fixture, `import { NodeRuntime, NodeServices } from ${JSON.stringify(import.meta.resolve('@effect/platform-node'))};
import { Effect } from ${JSON.stringify(import.meta.resolve('effect'))};
import { withGateResources } from ${JSON.stringify(pathToFileURL(resolve('scripts/gate-resources.ts')).href)};
withGateResources(${body}, { memoryMaxBytes: ${memoryMaxBytes}, reportRoot: ${JSON.stringify(reportRoot)} }).pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
`);
  const child = yield* spawner.spawn(ChildProcess.make(process.execPath, ['--import', import.meta.resolve('tsx'), fixture], {
    env: { ...process.env, CONCORD_GATE_SCOPE: undefined, CONCORD_GATE_REPORT: undefined,
      ...(noSystemd ? { PATH: join(root, 'no-systemd') } : {}) },
    stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  }));
  const [text, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(child.all)), child.exitCode], { concurrency: 'unbounded' });
  const reports = yield* fs.readDirectory(reportRoot);
  assert.equal(reports.length, 1, text);
  const report = Schema.decodeUnknownSync(Schema.fromJsonString(Report))(yield* fs.readFileString(join(reportRoot, reports[0]!, 'resources.json')));
  return { code: Number(code), text, report };
});

// @feature docs/engineering/testing/README.md#共享资源与同步
resourceTest('a real gate scope is separate from its caller and records cgroup peaks before exit', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const expectedScope = yield* hasSystemdScope;
  const result = yield* runFixture(root, 'Effect.sync(() => { const memory = Buffer.alloc(16 * 1024 * 1024, 1); console.log(memory[0]); })', GiB / 2);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.report.memoryIsolation, expectedScope ? 'systemd-scope' : 'unavailable', result.text);
  if (result.report.memoryIsolation === 'unavailable') {
    assert.equal(typeof result.report.reason, 'string');
    return;
  }
  assert.equal(result.report.memoryMaxBytes, GiB / 2);
  assert.equal(result.report.memorySwapMaxBytes, 0);
  assert.equal(result.report.memorySwapPeakBytes, 0);
  assert.equal(result.report.exitCode, 0);
  assert.ok(result.report.cgroup?.endsWith(`/${result.report.unit}`));
  const parent = process.platform === 'linux' ? yield* fs.readFileString('/proc/self/cgroup') : '';
  assert.equal(parent.includes(result.report.unit!), false, 'gate entered its caller scope');
  assert.ok(result.report.memoryPeakBytes !== null && result.report.memoryPeakBytes >= 16 * 1024 * 1024 && result.report.memoryPeakBytes <= GiB / 2, result.text);
  assert.equal(yield* fs.exists(result.report.cgroup!), false, 'gate left its scope populated');
}));

// @feature docs/engineering/testing/README.md#共享资源与同步
resourceTest('scope OOM kills only the gate and leaves its peak report readable to the surviving caller', root => Effect.gen(function*() {
  const expectedScope = yield* hasSystemdScope;
  const memoryMax = GiB / 8;
  const result = yield* runFixture(root, 'Effect.sync(() => { const memory: Buffer[] = []; for (let i = 0; i < 24; i++) memory.push(Buffer.alloc(16 * 1024 * 1024, 1)); })', memoryMax);
  assert.equal(result.report.memoryIsolation, expectedScope ? 'systemd-scope' : 'unavailable', result.text);
  if (result.report.memoryIsolation === 'unavailable') return;
  assert.notEqual(result.code, 0, result.text);
  assert.equal(result.report.memoryMaxBytes, memoryMax);
  assert.equal(result.report.memoryPeakBytes, memoryMax, result.text);
  assert.equal(result.report.memorySwapPeakBytes, 0);
  assert.equal(result.report.exitCode, result.code);
}));

// @feature docs/engineering/testing/README.md#共享资源与同步
resourceTest('unavailable systemd keeps the workload result and explicitly reports the isolation reason', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const successRoot = join(root, 'success'), failedRoot = join(root, 'failed');
  yield* fs.makeDirectory(successRoot);
  yield* fs.makeDirectory(failedRoot);
  const success = yield* runFixture(successRoot, 'Effect.void', GiB, true);
  assert.equal(success.code, 0, success.text);
  assert.equal(success.report.memoryIsolation, 'unavailable');
  assert.equal(success.report.exitCode, 0);
  assert.equal(typeof success.report.reason, 'string');
  const failed = yield* runFixture(failedRoot, "Effect.fail(new Error('intentional workload failure'))", GiB, true);
  assert.equal(failed.code, 1, failed.text);
  assert.equal(failed.report.exitCode, 1);
  assert.equal(failed.report.memoryIsolation, 'unavailable');
}));
