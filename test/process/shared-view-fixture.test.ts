// 跨进程保证：进程终止与信号——共享浏览器fixture各种scope结局都等待真实服务退出并清理socket，stop不得在服务仍退出时成功。
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { test } from 'node:test';
import { Effect, Exit, Scope } from 'effect';
import { acquireSharedViewFixture } from '../support/shared-view-fixture.ts';
import { fetchFresh, parseWorkspaceProjection } from '../support/support.ts';
import { command, fixture, record, recordPath, stop } from '../support/workspace-server-fixture.ts';
import { rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { get } from 'node:http';
import { once } from 'node:events';
import { pollUntil } from '../support/support.ts';
import { tmpdir } from '../support/temporary.ts';
import { initialize } from '../support/operations.ts';
import { LocalRepository } from '../support/repository.ts';
import { retainConsumer } from '../support/consumer.ts';

// @feature docs/engineering/testing/architecture.md#共享服务
test('failed final view fixture releases retain existing roots in the outer cleanup receipt', async () => {
  const diagnostic = mkdtempSync(join(tmpdir(), 'concord-view-retention-test-'));
  const receipt = join(diagnostic, 'retained.txt');
  const previousReceipt = process.env.CONCORD_TEST_RETAIN_FILE;
  process.env.CONCORD_TEST_RETAIN_FILE = receipt;
  try {
    const scope = Effect.runSync(Scope.make());
    const shared = await Effect.runPromise(acquireSharedViewFixture().pipe(Scope.provide(scope)));
    const closeShared = shared.server.close.bind(shared.server);
    shared.server.close = async () => { throw new Error('unconfirmed shared service close'); };
    try {
      await assert.rejects(Effect.runPromise(Scope.close(scope, Exit.void)));
      assert.equal(existsSync(shared.root), true, 'failed final service release preserves the worktree');
      assert.ok(readFileSync(receipt, 'utf8').split('\n').includes(shared.root), 'outer cleanup must receive the retained shared root');
    } finally {
      await closeShared();
      shared.repository.close();
    }


  } finally {
    if (previousReceipt === undefined) delete process.env.CONCORD_TEST_RETAIN_FILE;
    else process.env.CONCORD_TEST_RETAIN_FILE = previousReceipt;
    rmSync(diagnostic, { recursive: true, force: true });
  }
});

for (const mode of ['success', 'assertion-failure', 'timeout'] as const) {
  // @feature docs/engineering/testing/architecture.md#共享服务
  test(`shared view service restores its frozen fixture and releases process and worktree after ${mode}`, () => Effect.runPromise(Effect.gen(function*() {
    let root: string | undefined;
    let pid: number | undefined;
    let service: Awaited<ReturnType<typeof record>> | undefined;
    let reachedOutcome = false;
    const exit = yield* Effect.exit(Effect.scoped(Effect.gen(function*() {
      const fixture = yield* acquireSharedViewFixture();
      root = fixture.root;
      pid = fixture.server.process.pid;
      service = record(fixture.root);
      yield* Effect.tryPromise(async () => {
        assert.equal(pid, service?.pid, 'the fixture directly owns server run without a View host');
        const url = new URL('/api/workspace', fixture.server.address);
        const before = parseWorkspaceProjection(await (await fetchFresh(url)).text())!;
        const server = fixture.server;
        writeFileSync(join(fixture.root, 'docs/extra.md'), '# Added between cases\n');
        await fixture.ready();
        await fixture.restore();
        assert.equal(fixture.server, server);
        assert.equal(fixture.server.process.pid, pid);
        assert.equal(record(fixture.root).pid, service?.pid, 'restoring a case keeps the worker service process');
        assert.equal(record(fixture.root).token, service?.token, 'restoring a case keeps the service instance');
        assert.equal(existsSync(join(fixture.root, 'docs/extra.md')), false);
        const after = parseWorkspaceProjection(await (await fetchFresh(url)).text())!;
        assert.equal(after.projection.sourceDigest, before.projection.sourceDigest);
      });
      reachedOutcome = true;
      if (mode === 'assertion-failure') yield* Effect.sync(() => assert.fail('Intentional lifecycle failure'));
      if (mode === 'timeout') yield* Effect.never.pipe(Effect.timeout(1));
    })));
    assert.equal(reachedOutcome, true, 'fixture body reached its intended outcome');
    assert.equal(exit._tag, mode === 'success' ? 'Success' : 'Failure', inspect(exit, { depth: 8 }));
    assert.ok(root && pid);
    assert.equal(existsSync(root), false, 'scope deletes the stopped service worktree');
    const stoppedPid = pid;
    assert.throws(() => process.kill(stoppedPid, 0), { code: 'ESRCH' }, 'scope waits for service exit');
    assert.ok(service);
    assert.equal(existsSync(service.socket.path), false, 'scope removes the service socket outside the worktree');
    const stoppedServicePid = service.pid;
    let processState = 'gone', exited = false;
    try {
      process.kill(stoppedServicePid, 0);
      if (process.platform === 'linux') {
        processState = readFileSync(`/proc/${stoppedServicePid}/stat`, 'utf8');
        exited = /^[ZX] /u.test(processState.slice(processState.lastIndexOf(')') + 2));
      }
    } catch (cause) {
      if (!['ESRCH', 'ENOENT'].includes((cause as NodeJS.ErrnoException).code ?? '')) throw cause;
      exited = true;
    }
    assert.equal(exited, true, `scope waits for the workspace service process: ${processState}`);
  })));
}

// @feature docs/engineering/testing/architecture.md#共享服务
test('another view case waits for context and connection closure, and clean restores still publish a fresh frozen-source projection', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fixture = yield* acquireSharedViewFixture();
  yield* Effect.tryPromise(async () => {
    const url = new URL('/api/workspace', fixture.server.address);
    const initial = parseWorkspaceProjection(await (await fetchFresh(url)).text())!;
    const request = get(new URL('/api/events', fixture.server.address), { agent: false });
    const [response] = await once(request, 'response');
    assert.equal(response.statusCode, 200);
    response.resume();
    const subscriptionClosed = once(response, 'close');
    let release!: () => void;
    let entered!: () => void;
    const enteredClose = new Promise<void>(resolve => { entered = resolve; });
    const closed = new Promise<void>(resolve => { release = resolve; });
    const path = join(fixture.root, 'docs/extra.md');
    let finishing: Promise<void> | undefined;
    let restoring: Promise<void> | undefined;
    try {
      writeFileSync(path, '# Last case still owns this file\n');
      finishing = fixture.finishAttempt(async () => {
        entered(); await closed;
        response.destroy();
        await subscriptionClosed;
      });
      await enteredClose;
      restoring = fixture.restore();
      // The synchronous probe runs after restore's first suspension, without elapsed-time waits.
      await Promise.resolve();
      assert.equal(existsSync(path), true, 'restoration cannot mutate files while context close is pending');
      release();
      await finishing;
      assert.equal(response.destroyed, true, 'the real HTTP subscription has closed');
      await restoring;
      assert.equal(existsSync(path), false);
      const after = parseWorkspaceProjection(await (await fetchFresh(url)).text())!;
      assert.equal(after.projection.sourceDigest, initial.projection.sourceDigest);
      await fixture.restore();
      const clean = parseWorkspaceProjection(await (await fetchFresh(url)).text())!;
      assert.ok(Date.parse(clean.projection.builtFrom) > Date.parse(after.projection.builtFrom), 'a clean repository still refreshes');
      assert.equal(clean.projection.sourceDigest, initial.projection.sourceDigest);
      const failure = new Error('context close was not confirmed');
      await assert.rejects(fixture.finishAttempt(() => Promise.reject(failure)), cause => cause === failure);
      writeFileSync(path, 'retained for cleanup failure');
      await assert.rejects((fixture.restore()), cause => cause === failure);
      await assert.rejects(fixture.finishAttempt(async () => (await Promise.resolve())), cause => cause === failure);
      await assert.rejects((fixture.restore()), cause => cause === failure);
      assert.equal(readFileSync(path, 'utf8'), 'retained for cleanup failure');
    } finally {
      release();
      response.destroy();
      request.destroy();
      await Promise.allSettled([subscriptionClosed, finishing, restoring]);
    }
  });
}))));

// @feature docs/feature/local-sdlc/cli.md
test('server stop refuses success while the recorded service is still exiting after releasing its lock', async () => {
  const root = (await fixture());
  const marker = join(root, 'exiting');
  const release = join(root, 'release');
  const preload = join(root, 'exit-barrier.mjs');
  // A real service reaches its exit handler after releasing all service resources.
  // The external child is an explicit barrier, released in finally, not a sleep.
  writeFileSync(preload, `
    import { writeFileSync } from 'node:fs';
    import { spawnSync } from 'node:child_process';
    if (process.argv.includes('server') && process.argv.includes('run')) {
      process.once('exit', () => {
        writeFileSync(${JSON.stringify(marker)}, 'exiting');
        spawnSync(process.execPath, ['--input-type=module', '-e', ${JSON.stringify("import { existsSync, watch } from 'node:fs'; const release = process.argv[1]; if (!existsSync(release)) { const watcher = watch(release.slice(0, release.lastIndexOf('/')), () => { if (existsSync(release)) watcher.close(); }); if (existsSync(release)) watcher.close(); }")}, ${JSON.stringify(release)}], { env: { ...process.env, NODE_OPTIONS: '' } });
      });
    }
  `);
  let firstStop: ReturnType<typeof command> | undefined;
  let stopOutcome: PromiseSettledResult<Awaited<ReturnType<typeof command>>> | undefined;
  let servicePid: number | undefined;
  let reachedBarrier = false, residualRecord = false;
  const failures: unknown[] = [];
  try {
    const started = await command(root, ['server', 'start'], undefined, {
      ...process.env, BUN_OPTIONS: `${process.env.BUN_OPTIONS ?? ''} --preload=${pathToFileURL(preload).href}`,
    });
    assert.equal(started.status, 0, JSON.stringify(started));
    const owner = record(root);
    servicePid = owner.pid;
    const original = JSON.parse(readFileSync(recordPath(root), 'utf8'));
    firstStop = command(root, ['server', 'stop']);
    void firstStop.then(value => { stopOutcome = { status: 'fulfilled', value }; }, reason => { stopOutcome = { status: 'rejected', reason }; });
    await pollUntil(async () => {
      if (existsSync(marker)) return true;
      if (stopOutcome?.status === 'rejected') throw stopOutcome.reason;
      if (stopOutcome?.status === 'fulfilled') assert.fail(`First stop ended before the service reached its exit barrier: ${JSON.stringify(stopOutcome.value)}`);
      return undefined;
    }, { description: 'real service reached the exit barrier', timeoutMs: 8000 });
    reachedBarrier = true;
    // Reconstruct the residual stopping record to exercise a second caller after
    // lock release. Its PID and lock identity belong to the actual service.
    writeFileSync(recordPath(root), JSON.stringify({ ...original, state: 'stopping' }));
    residualRecord = true;
    const result = await command(root, ['server', 'stop']);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stderr || result.stdout).error, 'CleanupFailed');
    assert.doesNotThrow(() => process.kill(owner.pid, 0), 'the barrier keeps the real service alive');
  } catch (cause) { failures.push(cause); } finally {
    const cleanup: unknown[] = [];
    try { writeFileSync(release, 'release'); } catch (cause) { cleanup.push(cause); }
    try {
      if (servicePid === undefined && existsSync(recordPath(root))) servicePid = record(root).pid;
      // A rejected shutdown did not reach the barrier; terminate only this fixture's owner.
      if (!reachedBarrier && servicePid !== undefined) {
        try { process.kill(servicePid, 'SIGTERM'); }
        catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause; }
      }
    } catch (cause) { cleanup.push(cause); }
    try {
      if (firstStop) {
        const result = await firstStop;
        if (result.status !== 0) {
          assert.equal(reachedBarrier, true, `Shutdown failed before the exit barrier: ${JSON.stringify(result)}`);
          assert.equal(result.status, 1, JSON.stringify(result));
          assert.equal(JSON.parse(result.stderr || result.stdout).error, 'CleanupFailed', JSON.stringify(result));
        }
      }
    } catch (cause) { cleanup.push(cause); }
    let exited = servicePid === undefined && !existsSync(recordPath(root));
    try {
      const exitingPid = servicePid;
      if (exitingPid !== undefined) {
        await pollUntil(async () => {
          try {
            process.kill(exitingPid, 0);
            if (process.platform === 'linux') {
              const stat = readFileSync(`/proc/${exitingPid}/stat`, 'utf8');
              if (/^[ZX] /u.test(stat.slice(stat.lastIndexOf(')') + 2))) return true;
            }
            return undefined;
          } catch (cause) {
            if (['ESRCH', 'ENOENT'].includes((cause as NodeJS.ErrnoException).code ?? '')) return true;
            throw cause;
          }
        }, { description: 'exit-barrier service actually exits before fixture removal', timeoutMs: 8000 });
        exited = true;
      }
    } catch (cause) { cleanup.push(cause); }
    if (exited) {
      try {
        if (residualRecord) rmSync(recordPath(root), { force: true });
        await stop(root);
        if (cleanup.length === 0) rmSync(root, { recursive: true, force: true });
      } catch (cause) { cleanup.push(cause); }
    }
    if (cleanup.length) retainConsumer(root);
    failures.push(...cleanup);
  }
  if (failures.length) throw new AggregateError(failures, `Exit-barrier fixture failed; root: ${root}`);
});
