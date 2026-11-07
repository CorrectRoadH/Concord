// 跨进程保证：进程终止与信号——共享浏览器fixture各种scope结局都等待真实服务退出并清理socket，stop不得在服务仍退出时成功。
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { test } from 'node:test';
import { Effect, Exit, Scope } from 'effect';
import { acquireBrowserSharedFixture, browserWorkerFixture, closeBrowserWorker, openBrowserWorker } from '../support/browser-shared-fixture.ts';
import { fetchFresh, parseWorkspaceProjection } from '../support/support.ts';
import { command, fixture, record, recordPath, stop } from '../support/workspace-server-fixture.ts';
import { rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { get } from 'node:http';
import { once } from 'node:events';
import { installedConcordCli, pollUntil } from '../support/support.ts';
import { tmpdir } from '../support/temporary.ts';
import { initialize } from '../support/operations.ts';
import { LocalRepository } from '../support/repository.ts';

// @feature docs/engineering/testing/architecture.md#浏览器与诊断
test('failed final browser fixture releases retain existing roots in the outer cleanup receipt', async () => {
  const diagnostic = mkdtempSync(join(tmpdir(), 'concord-browser-retention-test-'));
  const receipt = join(diagnostic, 'retained.txt');
  const previousReceipt = process.env.CONCORD_TEST_RETAIN_FILE;
  process.env.CONCORD_TEST_RETAIN_FILE = receipt;
  try {
    const scope = Effect.runSync(Scope.make());
    const shared = await Effect.runPromise(acquireBrowserSharedFixture().pipe(Scope.provide(scope)));
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

    await openBrowserWorker();
    const worker = browserWorkerFixture();
    const root = worker.privateRoot();
    execFileSync('git', ['init', '-q', root]);
    const repository = new LocalRepository(root, { initialize: true });
    try { initialize(repository, false, { testRoots: [] }); } finally { repository.close(); }
    const server = await worker.privateServer({ root });
    const closePrivate = server.close.bind(server);
    server.close = async () => { throw new Error('unconfirmed private service close'); };
    try {
      await assert.rejects(worker.closePrivate());
      assert.equal(readFileSync(receipt, 'utf8').split('\n').includes(root), false, 'retryable intermediate cleanup must not register a receipt');
      await assert.rejects(closeBrowserWorker());
      assert.equal(existsSync(root), true, 'failed final private release preserves the worktree');
      assert.ok(readFileSync(receipt, 'utf8').split('\n').includes(root), 'outer cleanup must receive the retained private root');
      assert.equal(existsSync(worker.root), false, 'private cleanup failure still releases the shared service and root');
    } finally {
      server.close = closePrivate;
      await worker.closePrivate();
    }
  } finally {
    await closeBrowserWorker();
    if (previousReceipt === undefined) delete process.env.CONCORD_TEST_RETAIN_FILE;
    else process.env.CONCORD_TEST_RETAIN_FILE = previousReceipt;
    rmSync(diagnostic, { recursive: true, force: true });
  }
});

for (const mode of ['success', 'assertion-failure', 'timeout'] as const) {
  // @feature docs/engineering/testing/architecture.md#浏览器与诊断
  test(`shared browser service restores its frozen fixture and releases process and worktree after ${mode}`, () => Effect.runPromise(Effect.gen(function*() {
    let root: string | undefined;
    let pid: number | undefined;
    let service: ReturnType<typeof record> | undefined;
    let reachedOutcome = false;
    const exit = yield* Effect.exit(Effect.scoped(Effect.gen(function*() {
      const fixture = yield* acquireBrowserSharedFixture();
      root = fixture.root;
      pid = fixture.server.process.pid;
      service = record(fixture.root);
      yield* Effect.tryPromise(async () => {
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

// @feature docs/engineering/testing/architecture.md#浏览器与诊断
test('another browser case waits for context and connection closure, and clean restores still publish a fresh frozen-source projection', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fixture = yield* acquireBrowserSharedFixture();
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
      await assert.rejects(fixture.restore(), cause => cause === failure);
      await assert.rejects(fixture.finishAttempt(() => Promise.resolve()), cause => cause === failure);
      await assert.rejects(fixture.restore(), cause => cause === failure);
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
  const root = fixture();
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
  let firstStop: Promise<{ status: number | null; stdout: string; stderr: string }> | undefined;
  try {
    const child = spawn(process.execPath, [installedConcordCli(), '--root', root, '--json', 'server', 'start'], {
      env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(preload).href}` }, stdio: 'pipe',
    });
    let output = '';
    child.stdout.on('data', data => { output += String(data); });
    child.stderr.on('data', data => { output += String(data); });
    const started = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(started, 0, output);
    const owner = record(root);
    const original = JSON.parse(readFileSync(recordPath(root), 'utf8'));
    firstStop = command(root, ['server', 'stop']);
    await pollUntil(async () => existsSync(marker) ? true : undefined, { description: 'real service reached the exit barrier', timeoutMs: 8000 });
    // Reconstruct the residual stopping record to exercise a second caller after
    // lock release. Its PID and lock identity belong to the actual service.
    writeFileSync(recordPath(root), JSON.stringify({ ...original, state: 'stopping' }));
    const result = await command(root, ['server', 'stop']);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stderr || result.stdout).error, 'CleanupFailed');
    assert.doesNotThrow(() => process.kill(owner.pid, 0), 'the barrier keeps the real service alive');
  } finally {
    writeFileSync(release, 'release');
    await firstStop;
    rmSync(recordPath(root), { force: true });
    await stop(root);
    rmSync(root, { recursive: true, force: true });
  }
});
