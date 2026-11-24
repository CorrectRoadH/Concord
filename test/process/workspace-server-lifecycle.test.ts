// 跨进程保证：服务与 IPC——客户端断连只释放HTTP租约，服务被杀可恢复，私有目录删除后清理记录及精确socket。
import { makeRuntimeEnvironment, RuntimeEnvironment } from '../../src/base/environment/index.ts';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { Effect, Schema, Stream } from 'effect';
import { installationRootForBin } from '../../src/base/installation/index.ts';
import { installedConcordCli, pollUntil } from '../support/support.ts';
import { tmpdir } from '../support/temporary.ts';
import { startViewServer } from '../support/view-server.ts';
import { prepareSourceConsumer, sourceRoot } from '../support/source-consumer.ts';
import { sourceCli } from '../support/source-consumer.ts';
import { privateSourceInstallation } from '../support/private-source.ts';
import { scopedServerLock } from '../../src/base/server-lock/index.ts';
import { digest } from '../../src/model/index.ts';

import { recordPath, record, fixture, command, rpcModule, stop } from '../support/workspace-server-fixture.ts';

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);

// @feature docs/feature/web-workbench/README.md
test('disconnecting a view client releases its HTTP lease while the service remains available', { timeout: 20_000 }, async () => {
  const root = (await fixture());
  try {
    assert.equal((await command(root, ['server', 'start'])).status, 0);
    const running = record(root), rpc = await rpcModule();
    let address = '';
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const connection = yield* rpc.connectWorkspaceSocket(running.socket.path, running.installation, running.token);
      yield* Effect.promise(() => pollUntil(async () => {
        const hello = await Effect.runPromise(connection.client.hello({ protocol: rpc.PROTOCOL, installation: running.installation }));
        return ['running', 'degraded'].includes(hello.state) ? true : undefined;
      }, { description: 'the real service admits HTTP leases after opening', timeoutMs: 10_000 }));
      const lease = yield* rpc.requestWorkspace(connection, 'http', { action: 'open', host: '127.0.0.1', port: 0 });
      address = Schema.decodeUnknownSync(Schema.Struct({ address: Schema.String }))(lease).address;
      assert.ok((yield* Effect.promise(() => fetch(address))).ok);
    })));
    await pollUntil(async () => {
      try { await fetch(address, { signal: AbortSignal.timeout(500) }); return undefined; }
      catch { return true; }
    }, { description: 'disconnected view releases its listener', timeoutMs: 1500 });
    assert.equal((await command(root, ['server', 'status'])).status, 0);
    assert.equal(record(root).token, running.token);
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});


// @feature docs/feature/local-data-engine/README.md
test('a killed service releases persistent ownership and the next invocation can restart', { timeout: 30_000 }, async () => {
  const root = (await fixture());
  try {
    const started = await command(root, ['server', 'start']); assert.equal(started.status, 0, started.stderr);
    const before = record(root); process.kill(before.pid, 'SIGKILL');
    const read = await command(root, ['list', 'feature']); assert.equal(read.status, 0, read.stderr);
    const restarted = await command(root, ['server', 'start']); assert.equal(restarted.status, 0, restarted.stderr);
    assert.notEqual(record(root).token, before.token);
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});

// @spec docs/feature/portable-coordination/statechart.md#RecoveryBeforeFirstReply
test('the replacement service restores an interrupted publication before its first business reply', { timeout: 30_000 }, async () => {
  const root = await fixture();
  let killed: ReturnType<typeof record> | undefined;
  try {
    const started = await command(root, ['server', 'start']);
    assert.equal(started.status, 0, started.stderr);
    const prior = record(root);
    process.kill(prior.pid, 'SIGKILL');
    killed = prior;

    const privateDir = join(root, '.git/concord');
    const journal = join(privateDir, 'journal.json');
    const configPath = 'concord.config.ts';
    const configFile = join(root, configPath);
    const configSource = existsSync(configFile) ? readFileSync(configFile, 'utf8') : '';
    writeFileSync(join(root, 'docs/feature/reader/architecture.md'), '# Reader architecture\n');
    const changes = ['docs/feature/reader/README.md', 'docs/feature/reader/architecture.md'].map(path => {
      const before = readFileSync(join(root, path), 'utf8');
      const after = `${before}\nInterrupted publication.\n`;
      return { path, before, after, beforeDigest: digest(before), afterDigest: digest(after), mode: 0o644 };
    });
    const first = changes[0]!;
    writeFileSync(join(root, first.path), first.after);
    writeFileSync(journal, JSON.stringify({ format: 'concord.journal', root, privateDir, operation: 'interrupted', phase: 'prepared', directories: [], changes,
      scope: { kind: 'documents', configPath, configSource, configDigest: digest(configSource) },
    }));

    const restarted = await command(root, ['server', 'start']);
    assert.equal(restarted.status, 0, restarted.stderr);
    const current = record(root);
    assert.notEqual(current.token, prior.token);
    const rpc = await rpcModule();
    const body = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const connection = yield* rpc.connectWorkspaceSocket(current.socket.path, current.installation, current.token);
      yield* Effect.promise(() => pollUntil(async () => {
        const hello = await Effect.runPromise(connection.client.hello({ protocol: rpc.PROTOCOL, installation: current.installation }));
        return hello.state === 'opening' ? undefined : true;
      }, { description: 'replacement workspace service finishes opening', timeoutMs: 10_000 }));
      const read = yield* rpc.requestWorkspace(connection, 'read', { path: first.path, expectedDigest: first.beforeDigest });
      return read.body;
    })));
    assert.equal(body, first.before);
    assert.equal(existsSync(journal), false);
    for (const change of changes) assert.equal(readFileSync(join(root, change.path), 'utf8'), change.before);
  } finally {
    try {
      if (!killed || existsSync(recordPath(root)) && record(root).token !== killed.token) await stop(root);
      else rmSync(killed.socket.path, { force: true });
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// @feature docs/feature/local-data-engine/README.md
test('server stop confirms a dead owner through its lock despite a stale record and socket', { timeout: 20_000 }, async () => {
  const root = (await fixture());
  let staleSocket: string | undefined;
  try {
    const started = await command(root, ['server', 'start']); assert.equal(started.status, 0, started.stderr);
    const running = record(root);
    process.kill(running.pid, 'SIGKILL');
    staleSocket = running.socket.path;
    await pollUntil(async () => {
      const acquired = await Effect.runPromise(Effect.result(Effect.scoped(scopedServerLock(dirname(recordPath(root))).pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime)))));
      return acquired._tag === 'Success' ? true : undefined;
    }, { description: 'the operating system releases the killed service lock', timeoutMs: 5000 });
    assert.equal(record(root).token, running.token, 'the stale record is still present at the public stop boundary');
    assert.equal(existsSync(running.socket.path), true);
    const stopped = await command(root, ['server', 'stop']);
    assert.equal(stopped.status, 0, stopped.stdout + stopped.stderr);
  } finally {
    if (staleSocket) rmSync(staleSocket, { force: true });
    else await stop(root);
    rmSync(root, { recursive: true, force: true });
  }
});


// @feature docs/feature/local-data-engine/README.md
test('C22 deleting the Git-private directory stops the service and removes its exact socket', { timeout: 20_000 }, async () => {
  const root = (await fixture());
  let running: Awaited<ReturnType<typeof record>> | undefined;
  try {
    assert.equal((await command(root, ['server', 'start'])).status, 0);
    running = record(root);
    rmSync(join(root, '.git/concord'), { recursive: true, force: true });
    const started = performance.now();
    await pollUntil(async () => !existsSync(running!.socket.path) ? true : undefined, { description: 'service cleanup after Git-private directory deletion', timeoutMs: 6500 });
    assert.ok(performance.now() - started < 5500);
    assert.equal(existsSync(recordPath(root)), false);
  } finally {
    if (running && existsSync(running.socket.path)) try { process.kill(running.pid, 'SIGTERM'); } catch { /* already stopped */ }
    rmSync(root, { recursive: true, force: true });
  }
});
