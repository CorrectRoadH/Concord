// 跨进程保证：运行环境——进程内 CLI 返回前已启动真实维护 worker，后代使用本次 cwd/env，连续调用不串扰。
// 跨进程保证：进程终止与信号——测试持有真实维护 child 的退出结果，失败时确认退出或终止后才删除消费者。
// @concord-file
// @concord-implements docs/engineering/testing/architecture.md#进程内-cli
import assert from 'node:assert/strict';
import childProcess, { type ChildProcess } from 'node:child_process';
import { syncBuiltinMocks } from '../support/builtin-mocks.ts';
import { mkdirSync, realpathSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { cacheDatabasePath, cachePhysicalBytes, openHawdb } from '../../src/base/cache/index.ts';
import { makeRuntimeEnvironment, runtimeCacheHome } from '../../src/base/environment/index.ts';
import { CACHE_MAINTENANCE_THRESHOLD_BYTES } from '../../src/base/installation/index.ts';
import { runCli } from '../support/cli.ts';
import { createConsumer, retainConsumer } from '../support/consumer.ts';

const SpawnOptions = Schema.Struct({ cwd: Schema.String, env: Schema.Record(Schema.String, Schema.UndefinedOr(Schema.String)), detached: Schema.Literal(true) });
const SpawnIdentity = Schema.Struct({ pid: Schema.Int.check(Schema.isGreaterThan(0)), spawnargs: Schema.Array(Schema.String) });
interface WorkerExit { readonly code: number | null; readonly signal: NodeJS.Signals | null; readonly error?: Error }
interface MaintenanceChild { readonly child: ChildProcess; readonly closed: Promise<WorkerExit> }
interface MaintenanceSpawn { readonly root: string; readonly pid: number; readonly cwd: string; readonly env: Readonly<Record<string, string>> }

function workerRoot(child: ChildProcess, roots: readonly string[]): string | undefined {
  const root = child.spawnargs.at(-1);
  return root !== undefined && roots.includes(root) && child.spawnargs.some(arg => /\/cache-maintenance-worker\.(?:ts|js)$/u.test(arg.replaceAll('\\', '/'))) ? root : undefined;
}

function closedChild(child: ChildProcess): Promise<WorkerExit> {
  return new Promise(resolve => {
    let error: Error | undefined;
    child.once('error', cause => { error = cause; });
    child.once('close', (code, signal) => { resolve({ code, signal, ...(error === undefined ? {} : { error }) }); });
  });
}

async function waitForExit(closed: Promise<WorkerExit>, timeoutMs: number): Promise<WorkerExit | undefined> {
  let timer: Awaited<ReturnType<typeof setTimeout>> | undefined;
  try {
    return await Promise.race([closed, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), timeoutMs); })]);
  } finally { clearTimeout(timer); }
}

async function closeWorker(worker: MaintenanceChild): Promise<void> {
  let exited = await waitForExit(worker.closed, 10_000);
  if (exited === undefined) {
    assert.ok(worker.child.pid, 'only a real maintenance child may be terminated during cleanup');
    try {
      if (process.platform === 'win32') worker.child.kill('SIGKILL');
      else process.kill(-worker.child.pid, 'SIGKILL');
    } catch (cause) {
      if (!(cause instanceof Error && 'code' in cause && cause.code === 'ESRCH')) throw cause;
    }
    exited = await waitForExit(worker.closed, 10_000);
  }
  assert.ok(exited, 'maintenance worker exit must be confirmed before deleting its consumer');
  assert.equal(exited.error, undefined, 'the observed maintenance worker must start successfully');
}

function padCache(root: string, cwd: string, env: Readonly<NodeJS.ProcessEnv>): void {
  const privateDir = join(root, '.git/concord');
  const path = cacheDatabasePath(privateDir);
  const database = openHawdb(path, { create: true, readOnly: false }, makeRuntimeEnvironment(cwd, env));
  try { database.put('config_cache', [{ key: 'maintenance-fixture', payload: 'retained fixture value' }]); }
  finally { database.close(); }
  // This private, unmapped file contributes real length without allocating the whole budget.
  const padding = join(path, 'invocation-maintenance-padding');
  writeFileSync(padding, '');
  truncateSync(padding, CACHE_MAINTENANCE_THRESHOLD_BYTES + 1);
  assert.ok(cachePhysicalBytes(privateDir) > CACHE_MAINTENANCE_THRESHOLD_BYTES);
}

// @feature docs/engineering/testing/architecture.md#进程内-cli
test('CLI awaits the real maintenance spawn decision with each invocation environment', { timeout: 60_000 }, async t => {
  const roots: readonly [string, string] = [realpathSync((await createConsumer())), realpathSync((await createConsumer()))];
  const [rootA, rootB] = roots;
  const cwdA = join(rootA, 'invocation-a'), cwdB = join(rootB, 'invocation-b');
  const cacheHome = runtimeCacheHome(makeRuntimeEnvironment(process.cwd(), process.env));
  const envA = Object.freeze({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, XDG_CACHE_HOME: cacheHome, CONCORD_NATIVE_TEST_HOOKS: process.env.CONCORD_NATIVE_TEST_HOOKS, NODE_OPTIONS: '--conditions=concord-source', CONCORD_MAINTENANCE_INVOCATION: 'A' });
  const envB = Object.freeze({ ...envA, CONCORD_MAINTENANCE_INVOCATION: 'B' });
  const children: MaintenanceChild[] = [], observed: MaintenanceSpawn[] = [], observationFailures: unknown[] = [];
  const originalSpawn = childProcess.spawn;
  // Observe the public spawn boundary and forward the real process unchanged.
  childProcess.spawn = new Proxy(originalSpawn, { apply(target, receiver, args) {
    const child = Reflect.apply(target, receiver, args) as ChildProcess;
    const root = workerRoot(child, roots);
    if (root !== undefined) {
      children.push({ child, closed: closedChild(child) });
      try {
        const options = Schema.decodeUnknownSync(SpawnOptions, { onExcessProperty: 'ignore' })(args[2]);
        const identity = Schema.decodeUnknownSync(SpawnIdentity, { onExcessProperty: 'ignore' })(child);
        const env = Object.fromEntries(Object.entries(options.env).filter((row): row is [string, string] => row[1] !== undefined));
        observed.push({ root, pid: identity.pid, cwd: options.cwd, env });
      } catch (cause) { observationFailures.push(cause); }
    }
    return child;
  } });
  syncBuiltinMocks();
  try {
    mkdirSync(cwdA); mkdirSync(cwdB);
    padCache(rootA, cwdA, envA); padCache(rootB, cwdB, envB);
    const first = await runCli({ argv: ['--root', rootA, '--json', 'cache', 'rebuild'], cwd: cwdA, env: envA, signal: t.signal });
    assert.equal(observed.length, 1, 'A must observe its real maintenance worker at CLI return, before any further wait');
    assert.equal(first.exitCode, 0, first.stderr);
    assert.deepEqual(observationFailures, []);
    assert.equal(observed[0]?.root, rootA);
    assert.equal(observed[0]?.cwd, cwdA);
    assert.equal(observed[0]?.env.CONCORD_MAINTENANCE_INVOCATION, 'A');
    assert.equal(Object.hasOwn(observed[0]!.env, 'HOME'), false);
    assert.equal(Object.hasOwn(observed[0]!.env, 'USERPROFILE'), false);
    const second = await runCli({ argv: ['--root', rootB, '--json', 'cache', 'rebuild'], cwd: cwdB, env: envB, signal: t.signal });
    assert.equal(observed.length, 2, 'B must decide its own maintenance before returning without draining another A worker');
    assert.equal(second.exitCode, 0, second.stderr);
    assert.deepEqual(observationFailures, []);
    assert.deepEqual(observed.map(value => [value.root, value.cwd, value.env.CONCORD_MAINTENANCE_INVOCATION]), [[rootA, cwdA, 'A'], [rootB, cwdB, 'B']]);
    assert.equal(Object.hasOwn(observed[1]!.env, 'HOME'), false);
    assert.equal(Object.hasOwn(observed[1]!.env, 'USERPROFILE'), false);
  } finally {
    try {
      // A failed return-boundary assertion still owns any already queued setImmediate decisions.
      await new Promise<void>(resolve => setImmediate(resolve));
      const cleanup = await Promise.allSettled(children.map(closeWorker));
      const failed = cleanup.filter(result => result.status === 'rejected');
      if (failed.length > 0) {
        for (const root of roots) retainConsumer(root);
        throw new AggregateError(failed.map(result => result.reason), 'Maintenance cleanup unconfirmed; consumer roots retained');
      }
      for (const root of roots) rmSync(root, { recursive: true, force: true });
    } finally {
      childProcess.spawn = originalSpawn;
      syncBuiltinMocks();
    }
  }
});
