// 跨进程保证：服务与 IPC——共享服务跨用例复用身份，恢复来源与 index，并等待真实 RPC 租约释放。
// 跨进程保证：进程终止与信号——失败、取消与 Scope 关闭确认 PID 和 socket 回收，清理未确认时保留消费者。
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { tracingChannel } from 'node:diagnostics_channel';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Cause, Deferred, Effect, Schema, Stream, type Exit } from 'effect';
import { requestWorkspace } from '../../src/entry/server/index.ts';
import { ViewServerStartupFailed } from '../e2e/server.ts';
import { acquireSharedWorkspace, closeSharedWorkspace, sharedWorkspace, type SharedWorkspace } from '../support/shared-service.ts';
import { stopWorkspaceServer } from '../support/stop-workspace-server.ts';
import { fetchFresh, parseWorkspaceProjection } from '../support/support.ts';
import { tmpdir } from '../support/temporary.ts';

const git = (root: string, ...argv: string[]) => execFileSync('git', ['-C', root, ...argv]);

function assertExited(pid: number): void {
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      assert.match(stat.slice(stat.lastIndexOf(')') + 2), /^[ZX] /u, `service ${pid} must have exited: ${stat}`);
      return;
    }
  } catch (cause) {
    if (['ESRCH', 'ENOENT'].includes((cause as NodeJS.ErrnoException).code ?? '')) return;
    throw cause;
  }
  assert.fail(`service ${pid} is still running`);
}

function assertRemoved(workspace: SharedWorkspace, instance: SharedWorkspace['instance']): void {
  assert.equal(existsSync(workspace.root), false, 'consumer is deleted only after its service exits');
  assert.equal(existsSync(instance.socket.path), false, 'the external RPC socket is removed');
  assert.ok(workspace.pid);
  assertExited(workspace.pid);
  assertExited(instance.pid);
}

// @feature docs/engineering/testing/architecture.md#共享服务
test('shared service reuses one file singleton and restores tracked, untracked and staged bytes before the next run', () => Effect.runPromise(Effect.tryPromise(async () => {
  const [workspace, same] = await Promise.all([sharedWorkspace(), sharedWorkspace()]);
  assert.equal(workspace, same);
  const instance = workspace.instance;
  const clientPid = workspace.pid;
  const head = git(workspace.root, 'rev-parse', 'HEAD');
  const index = git(workspace.root, 'ls-files', '--stage', '-z');
  const tracked = 'docs/taste.md';
  const original = readFileSync(join(workspace.root, tracked));
  let digest: string | undefined;
  try {
    await assert.rejects(workspace.http('/api/workspace'));
    await assert.rejects(workspace.connection(() => Effect.void));
    await workspace.run(async current => {
      const before = await current.ready();
      digest = before.projection.sourceDigest;
      writeFileSync(join(current.root, tracked), Buffer.concat([original, Buffer.from('\nChanged source between cases.\n')]));
      writeFileSync(join(current.root, 'docs/staged.md'), '# Staged source\n');
      git(current.root, 'add', '--', tracked, 'docs/staged.md');
      writeFileSync(join(current.root, tracked), 'Unstaged bytes after staging\n');
      writeFileSync(join(current.root, 'docs/untracked.md'), '# Untracked source\n');
      const changed = await current.ready();
      assert.notEqual(changed.projection.sourceDigest, digest, 'explicit refresh observes the changed real sources');
    });
    const requestedAt = Date.now();
    await workspace.run(async current => {
      assert.equal(current, workspace);
      assert.equal(current.pid, clientPid);
      assert.deepEqual(current.instance, instance, 'restoration preserves PID, token and socket identity');
      assert.deepEqual(git(current.root, 'rev-parse', 'HEAD'), head);
      assert.deepEqual(git(current.root, 'ls-files', '--stage', '-z'), index);
      assert.deepEqual(readFileSync(join(current.root, tracked)), original);
      assert.equal(existsSync(join(current.root, 'docs/staged.md')), false);
      assert.equal(existsSync(join(current.root, 'docs/untracked.md')), false);
      assert.equal(git(current.root, 'status', '--porcelain').toString(), '');
      const response = await current.http('/api/workspace');
      assert.equal(response.status, 200, response.body);
      assert.match(response.type!, /^application\/json/u);
      assert.equal(response.headers.get('content-type'), response.type);
      const restored = parseWorkspaceProjection(response.body);
      assert.ok(restored, response.body);
      assert.equal(restored.projection.sourceDigest, digest);
      assert.equal(restored.projection.complete, true);
      assert.equal(restored.snapshot.complete, true);
      assert.deepEqual(restored.projection.changedPaths, []);
      assert.ok(Date.parse(restored.projection.builtFrom) >= requestedAt, 'restoration waits for a projection built after its refresh request');
    });
  } finally { await closeSharedWorkspace(); }
  assertRemoved(workspace, instance);
})));

const HttpLease = Schema.Struct({ host: Schema.String, port: Schema.Int, address: Schema.String, lease: Schema.String, token: Schema.String });

// @feature docs/engineering/testing/architecture.md#共享服务
test('run drains the real RPC Scope and HTTP lease before completing or admitting another case', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const workspace = yield* acquireSharedWorkspace();
  const entered = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  let leaseAddress: string | undefined;
  let finalized = false;
  let finished = false;
  let connection: Promise<void> | undefined;
  const running = workspace.run(async current => {
    connection = current.connection(peer => Effect.gen(function*() {
      const lease = yield* requestWorkspace(peer, 'http', { action: 'open', host: '127.0.0.1', port: 0 }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(HttpLease, { onExcessProperty: 'error' })));
      leaseAddress = lease.address;
      yield* Effect.addFinalizer(() => Effect.gen(function*() {
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
        yield* Stream.runDrain(peer.client.http({ ...peer.identity(), action: 'close', host: lease.host, port: lease.port, lease: lease.lease }));
        finalized = true;
      }).pipe(Effect.orDie));
    }));
    // The case body returns while the connection's own Scope is still finalizing.
    await Effect.runPromise(Deferred.await(entered));
    return 'case completed';
  }).then(value => { finished = true; return value; }, cause => { finished = true; throw cause; });
  yield* Effect.tryPromise(async () => {
    try {
      await Effect.runPromise(Deferred.await(entered));
      await assert.rejects(workspace.run(async () => assert.fail('concurrent case must not enter')));
      assert.ok(leaseAddress);
      // A real response is an external progress barrier, rather than an elapsed delay.
      const response = await fetchFresh(new URL('/api/workspace', leaseAddress));
      assert.equal(response.status, 200, await response.text());
      assert.equal(finalized, false);
      assert.equal(finished, false, 'run must remain pending while its real lease finalizer is held');
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); }
    assert.equal(await running, 'case completed');
    await connection;
    assert.equal(finalized, true);
  });
}))));

for (const outcome of ['failure', 'cancellation'] as const) {
  // @feature docs/engineering/testing/architecture.md#共享服务
  test(`shared service ${outcome} closes the service before returning while its owning Scope is still open`, () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const workspace = yield* acquireSharedWorkspace();
    const instance = workspace.instance;
    const entered = yield* Deferred.make<void>();
    const controller = new AbortController();
    const intended = new Error('intentional case failure');
    let rpcReleased = false;
    yield* Effect.tryPromise(async () => {
      const running = workspace.run(async current => {
        if (outcome === 'failure') throw intended;
        return current.connection(peer => Effect.gen(function*() {
          assert.equal(peer.hello.token, instance.token);
          yield* Effect.addFinalizer(() => Effect.sync(() => { rpcReleased = true; }));
          yield* Deferred.succeed(entered, undefined);
          yield* Effect.never;
        }));
      }, controller.signal);
      const rejected = assert.rejects(running, cause => outcome !== 'failure' || cause === intended);
      if (outcome === 'cancellation') {
        await Effect.runPromise(Deferred.await(entered));
        controller.abort(new Error('intentional case cancellation'));
      }
      await rejected;
      assert.equal(rpcReleased, outcome === 'cancellation');
      assertRemoved(workspace, instance);
      await assert.rejects(workspace.run(async () => assert.fail('closed service must not admit another case')));
    });
  }))));
}

const SpawnedView = Schema.Struct({ process: Schema.Struct({ pid: Schema.Int, spawnargs: Schema.Array(Schema.String) }) });

for (const outcome of ['failure', 'cancellation'] as const) {
  // @feature docs/engineering/testing/architecture.md#共享服务
  test(`shared service startup ${outcome} removes the consumer after confirmed cleanup`, () => Effect.runPromise(Effect.gen(function*() {
    const controller = new AbortController();
    const previous = process.env.NODE_OPTIONS;
    const spawning = tracingChannel('child_process.spawn');
    let startupPid: number | undefined;
    const spawned = (value: unknown) => {
      // Node publishes spawn:end before assigning child.pid; the microtask sees the completed spawn.
      queueMicrotask(() => {
        const decoded = Schema.decodeUnknownExit(SpawnedView, { onExcessProperty: 'ignore' })(value);
        if (decoded._tag !== 'Success' || !decoded.value.process.spawnargs.includes('server') || !decoded.value.process.spawnargs.includes('run')) return;
        startupPid = decoded.value.process.pid;
        if (outcome === 'cancellation') controller.abort(new Error('cancel during startup'));
      });
    };
    spawning.end.subscribe(spawned);
    let exit: Exit.Exit<SharedWorkspace, unknown>;
    try {
      if (outcome === 'failure') process.env.NODE_OPTIONS = '--concord-intentional-invalid-startup-option';
      exit = yield* Effect.exit(Effect.scoped(acquireSharedWorkspace(controller.signal)));
    } finally {
      spawning.end.unsubscribe(spawned);
      if (previous === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previous;
    }
    assert.equal(exit._tag, 'Failure');
    if (exit._tag !== 'Failure') return;
    const error = Cause.squash(exit.cause);
    assert.ok(Cause.isUnknownError(error));
    assert.ok(error.cause instanceof ViewServerStartupFailed);
    assert.equal(error.cause.cleanupComplete, true);
    assert.equal(existsSync(error.cause.root), false, 'partial acquisition must not leave a consumer behind');
    assert.ok(startupPid, 'startup reached a real OS child before failing or being cancelled');
    assertExited(startupPid);
  })));
}

// @feature docs/engineering/testing/architecture.md#共享服务
test('unconfirmed real service cleanup preserves the consumer and its diagnostic bytes', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const workspace = yield* acquireSharedWorkspace();
  const instance = workspace.instance;
  const path = join(workspace.root, '.git/concord/server/current.json');
  const record = readFileSync(path);
  const diagnostic = Buffer.from('unreadable instance record retained for diagnosis\n');
  yield* Effect.tryPromise(async () => {
    try {
      await assert.rejects(workspace.run(async () => {
        // Corruption is private to this lifecycle test; the real stop command must refuse it.
        writeFileSync(path, diagnostic);
        throw new Error('intentional failure with unreadable cleanup record');
      }));
      assert.equal(existsSync(workspace.root), true, 'unconfirmed service cleanup must retain the root');
      assert.deepEqual(readFileSync(path), diagnostic);
      assert.doesNotThrow(() => process.kill(instance.pid, 0), 'the actual service remains alive until explicit recovery');
    } finally {
      if (existsSync(workspace.root)) {
        writeFileSync(path, record);
        stopWorkspaceServer(workspace.root);
        assertExited(instance.pid);
        rmSync(workspace.root, { recursive: true, force: true });
      }
    }
    assertRemoved(workspace, instance);
  });
}))));

const ChildRecord = Schema.Struct({ root: Schema.String, pid: Schema.Int, instance: Schema.Struct({ pid: Schema.Int, socket: Schema.Struct({ path: Schema.String }) }) });

// @feature docs/engineering/testing/architecture.md#共享服务
test('the real Node file after hooks stop the singleton before consumer template cleanup', () => Effect.runPromise(Effect.tryPromise(async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-shared-after-'));
  const marker = join(scratch, 'instance.json');
  const entry = join(scratch, 'after.test.ts');
  let owned: typeof ChildRecord.Type | undefined;
  writeFileSync(entry, `
    import test from 'node:test';
    import { writeFileSync } from 'node:fs';
    import { sharedWorkspace } from ${JSON.stringify(new URL('../support/shared-service.ts', import.meta.url).href)};
    test('file owns its singleton until the real after hooks', async () => {
      const workspace = await sharedWorkspace();
      await workspace.run(async current => {
        const { pid, socket } = current.instance;
        writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ root: current.root, pid: current.pid, instance: { pid, socket: { path: socket.path } } }));
      });
    });
  `);
  try {
    const env = { ...process.env };
    // The nested runner is a separate lifecycle subject, not another file of its parent runner.
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, ['--conditions=concord-source', '--import', new URL('../support/source-runtime.ts', import.meta.url).href, '--test', entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += String(data); });
    child.stderr.on('data', data => { stderr += String(data); });
    const status = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    if (existsSync(marker)) owned = Schema.decodeUnknownSync(Schema.fromJsonString(ChildRecord), { onExcessProperty: 'error' })(readFileSync(marker, 'utf8'));
    assert.deepEqual(status, { code: 0, signal: null }, `child Node runner: ${stdout}\n${stderr}`);
    assert.ok(owned, `child did not reach its ready singleton: ${stdout}\n${stderr}`);
    assert.equal(existsSync(owned.root), false);
    assert.equal(existsSync(owned.instance.socket.path), false);
    assertExited(owned.pid);
    assertExited(owned.instance.pid);
  } finally {
    if (owned && existsSync(owned.root)) {
      stopWorkspaceServer(owned.root);
      rmSync(owned.root, { recursive: true, force: true });
    }
    rmSync(scratch, { recursive: true, force: true });
  }
})));
