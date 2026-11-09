// 跨进程保证：服务与 IPC——停止服务时升级终止不响应 SIGTERM 的操作子进程并确认资源已释放。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { pollUntil } from '../support/support.ts';
import { command, fixture, record, recordPath, rpcModule, stop } from '../support/workspace-server-fixture.ts';

// @feature docs/feature/local-data-engine/architecture.md#退出
test('shutdown confirms cleanup when the idle operation process cannot handle SIGTERM', { skip: process.platform === 'win32', timeout: 30_000 }, async () => {
  const root = await fixture();
  let child: number | undefined;
  try {
    const started = await command(root, ['server', 'start']);
    assert.equal(started.status, 0, started.stdout + started.stderr);
    const running = record(root);
    child = await pollUntil(async () => {
      const status = await command(root, ['server', 'status']);
      if (!['running', 'degraded'].includes(JSON.parse(status.stdout).state)) return undefined;
      for (const line of execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' }).split('\n')) {
        const row = /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
        if (row && Number(row[2]) === running.pid && /\/entry\/server\/operation\/main\.ts(?:\s|$)/u.test(row[3]!)) return Number(row[1]);
      }
      return undefined;
    }, { description: 'the service is ready with its owned idle operation process', timeoutMs: 10_000 });
    process.kill(child, 'SIGSTOP');
    const stopped = await command(root, ['server', 'stop']);
    assert.equal(stopped.status, 0, stopped.stdout + stopped.stderr);
    assert.equal(existsSync(recordPath(root)), false);
    assert.equal(existsSync(running.socket.path), false);
    assert.throws(() => process.kill(child!, 0), /ESRCH|No such process/u);
    const restarted = await command(root, ['server', 'start']);
    assert.equal(restarted.status, 0, restarted.stdout + restarted.stderr);
    assert.notEqual(record(root).token, running.token, 'the next service acquires the released lock');
  } finally {
    if (child !== undefined) try { process.kill(child, 'SIGCONT'); } catch { /* already reaped */ }
    await stop(root);
    rmSync(root, { recursive: true, force: true });
  }
});

// @feature docs/feature/local-data-engine/architecture.md#退出
test('interrupting the service completes an active HTTP operation and releases every owned process', { skip: process.platform === 'win32', timeout: 30_000 }, async () => {
  const root = await fixture();
  const boundary = join(root, 'operation-paused');
  const env = { ...process.env, CONCORD_TEST_OPERATION_PAUSED: boundary,
    BUN_OPTIONS: `${process.env.BUN_OPTIONS ?? ''} --preload=${fileURLToPath(new URL('../fixtures/operation-pause-preload.ts', import.meta.url))}`.trim() };
  let running: ReturnType<typeof record> | undefined;
  let children: number[] = [];
  try {
    const started = await command(root, ['server', 'start'], undefined, env);
    assert.equal(started.status, 0, started.stdout + started.stderr);
    running = record(root);
    const instance = running, rpc = await rpcModule();
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const connection = yield* rpc.connectWorkspaceSocket(instance.socket.path, instance.installation, instance.token);
      yield* Effect.promise(() => pollUntil(async () => {
        const hello = await Effect.runPromise(connection.client.hello({ protocol: rpc.PROTOCOL, installation: instance.installation }));
        return ['running', 'degraded'].includes(hello.state) ? true : undefined;
      }, { description: 'the real service admits the HTTP operation', timeoutMs: 10_000 }));
      const listener = Schema.decodeUnknownSync(Schema.Struct({ address: Schema.String }))(yield* rpc.requestWorkspace(connection, 'http', { action: 'open', host: '127.0.0.1', port: 0 }));
      const request = fetch(new URL('/api/action', listener.address), { method: 'POST', headers: { 'Content-Type': 'application/json', Connection: 'close' },
        body: JSON.stringify({ action: 'document.set', path: 'docs/feature/reader/README.md', body: '# Reader\n', expectedDigest: 'missing' }), signal: AbortSignal.timeout(15_000) }).then(response => response.text(), () => 'disconnected');
      yield* Effect.promise(() => pollUntil(async () => existsSync(boundary) ? true : undefined, { description: 'the real operation child accepts its request before cancellation' }));
      children = execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' }).split('\n').flatMap(line => {
        const row = line.trim().split(/\s+/u); return Number(row[1]) === instance.pid ? [Number(row[0])] : [];
      });
      assert.ok(children.includes(Number(readFileSync(boundary, 'utf8'))));
      process.kill(instance.pid, 'SIGTERM');
      yield* Effect.promise(() => pollUntil(async () => !existsSync(recordPath(root)) ? true : undefined, { description: 'service interruption releases the HTTP operation and its ownership', timeoutMs: 8000 }));
      yield* Effect.promise(() => request);
      for (const pid of children) assert.throws(() => process.kill(pid, 0), /ESRCH|No such process/u);
    })));
  } finally {
    // A failing lifecycle regression must still release only its own fixture.
    if (running && existsSync(recordPath(root))) {
      for (const pid of [...children, running.pid]) try { process.kill(pid, 'SIGKILL'); } catch { /* reaped */ }
      await command(root, ['server', 'stop']);
    } else await stop(root);
    rmSync(root, { recursive: true, force: true });
  }
});
