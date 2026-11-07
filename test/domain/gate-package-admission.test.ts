import assert from 'node:assert/strict';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Deferred, Effect, Fiber, FileSystem } from 'effect';
import { join, resolve } from 'node:path';
import { nativeSourceFiles } from '../../src/base/installation/native-artifact.ts';
import { preparePackagingFixture, readPackagePreparation } from '../../scripts/gate-package.ts';
import { gateMemoryBudgets, GiB, makeGateAdmission, withGateAdmission } from '../../scripts/gate-resources.ts';
import { tmpdir } from '../support/temporary.ts';

// @feature docs/engineering/testing/cli.md#并发
test('archive preparation shares the pool, persists failure receipts and returns admission only after builder exit', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-archive-admission-' });
  const checkout = join(root, 'checkout'), cache = join(root, 'cache'), bin = join(root, 'bin');
  yield* fs.makeDirectory(checkout);
  yield* fs.makeDirectory(bin);
  for (const path of [...nativeSourceFiles, 'native/hawdb/Cargo.lock']) {
    yield* fs.makeDirectory(resolve(checkout, path, '..'), { recursive: true });
    yield* fs.writeFile(join(checkout, path), yield* fs.readFile(resolve(path)));
  }
  const started = join(root, 'started'), release = join(root, 'release');
  yield* fs.writeFileString(join(bin, 'pnpm'), `#!${process.execPath}\nimport {writeFileSync,existsSync} from 'node:fs';\nwriteFileSync(${JSON.stringify(started)}, String(process.pid));\nwhile(!existsSync(${JSON.stringify(release)})) await new Promise(resolve=>setTimeout(resolve,10));\nprocess.exit(9);\n`);
  yield* fs.chmod(join(bin, 'pnpm'), 0o755);
  const previous = { PATH: process.env.PATH, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME };
  yield* Effect.acquireRelease(Effect.sync(() => { process.env.PATH = `${bin}:${process.env.PATH}`; process.env.XDG_CACHE_HOME = cache; }), () => Effect.sync(() => {
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }));
  const pool = yield* makeGateAdmission(5 * GiB);
  const report = join(root, 'preparation.json');
  const preparation = yield* preparePackagingFixture(checkout, report, pool).pipe(Effect.forkScoped);
  yield* Effect.gen(function*() { while (!(yield* fs.exists(started))) yield* Effect.sleep('10 millis'); }).pipe(Effect.timeout('10 seconds'));
  const pid = Number(yield* fs.readFileString(started));
  const entered = yield* Deferred.make<void>();
  const packaging = yield* Deferred.succeed(entered, undefined).pipe(withGateAdmission(pool, gateMemoryBudgets.packaging, 'packaging'), Effect.forkScoped);
  assert.equal(yield* Deferred.isDone(entered), false, 'five GiB packaging cannot overlap admitted archive preparation');
  yield* fs.writeFileString(release, 'release');
  const result = yield* Fiber.join(preparation);
  yield* Fiber.join(packaging);
  assert.equal(result.state, 'failed');
  assert.deepEqual(yield* readPackagePreparation(report), result);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert.equal(yield* Deferred.isDone(entered), true);
  assert.deepEqual(pool.timings.map(row => [row.category, row.bytes]), [['archive-preparation', 2.5 * GiB], ['packaging', 5 * GiB]]);
  const insufficient = yield* preparePackagingFixture(checkout, join(root, 'insufficient.json'), yield* makeGateAdmission(2 * GiB));
  assert.equal(insufficient.state, 'failed');
  if (insufficient.state === 'failed') assert.match(insufficient.message, /GateResourcesInvalid/u);
  yield* fs.remove(started);
  yield* fs.remove(release);
  const cancelledReport = join(root, 'cancelled.json');
  const cancelled = yield* preparePackagingFixture(checkout, cancelledReport, pool).pipe(Effect.forkScoped);
  yield* Effect.gen(function*() { while (!(yield* fs.exists(started))) yield* Effect.sleep('10 millis'); }).pipe(Effect.timeout('10 seconds'));
  const cancelledPid = Number(yield* fs.readFileString(started));
  yield* Fiber.interrupt(cancelled);
  assert.equal((yield* readPackagePreparation(cancelledReport)).state, 'failed');
  assert.throws(() => process.kill(cancelledPid, 0), { code: 'ESRCH' });
  yield* Effect.void.pipe(withGateAdmission(pool, 5 * GiB, 'packaging-after-cancel'));
})).pipe(Effect.provide(NodeServices.layer))));
