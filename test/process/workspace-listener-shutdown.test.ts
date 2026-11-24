// 跨进程保证：服务与 IPC——Unix 监听关闭回调待决时，仍可确认连接、记录与服务锁已释放。
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Schema } from 'effect';
import { acquireFileLock } from '../../src/base/file-lock/index.ts';
import { sourceCliCommand } from '../support/source-consumer.ts';
import { pollUntil } from '../support/support.ts';
import { command, fixture, record, recordPath } from '../support/workspace-server-fixture.ts';

const Closing = Schema.fromJsonString(Schema.Struct({ cleanup: Schema.Struct({ phase: Schema.String, pid: Schema.Int }) }));

// @spec docs/feature/local-data-engine/architecture.md#退出
// @spec docs/feature/local-data-engine/statechart.md#UpgradeEventuallyServes
test('shutdown confirms listener release with its close callback withheld', { skip: process.platform === 'win32', timeout: 35_000 }, async () => {
  const root = await fixture();
  const current = recordPath(root);
  const boundary = join(root, 'listener-close');
  const release = join(root, 'listener-release');
  const preload = fileURLToPath(new URL('../fixtures/listener-close-preload.ts', import.meta.url));
  const server = Bun.spawn({
    cmd: [...sourceCliCommand(undefined, ['--preload', preload]), '--root', root, 'server', 'run'],
    env: { ...process.env, CONCORD_TEST_LISTENER_RECORD: current, CONCORD_TEST_LISTENER_CLOSE: boundary, CONCORD_TEST_LISTENER_RELEASE: release },
    stdout: 'ignore', stderr: 'inherit',
  });
  let peer: ReturnType<typeof createConnection> | undefined;
  try {
    await pollUntil(async () => {
      const status = await command(root, ['server', 'status']);
      return /"state"\s*:\s*"(?:running|degraded)"/u.test(status.stdout) ? true : undefined;
    }, { description: 'the foreground service admits connections', timeoutMs: 10_000 });
    const running = record(root);
    assert.equal(running.pid, server.pid);
    peer = createConnection(running.socket.path);
    const peerClosed = once(peer, 'close');
    void peerClosed.catch(() => undefined);
    await once(peer, 'connect');

    const stopped = await command(root, ['server', 'stop']);
    assert.ok(existsSync(boundary), 'the fault injection reached the real Unix listener');
    assert.equal(stopped.status, 0, stopped.stdout + stopped.stderr);
    const { cleanup } = Schema.decodeUnknownSync(Closing, { onExcessProperty: 'ignore' })(readFileSync(boundary, 'utf8'));
    assert.deepEqual(cleanup, { phase: 'listener', pid: server.pid });
    assert.deepEqual(await peerClosed, [false]);
    assert.equal(await server.exited, 0);
    assert.equal(existsSync(current), false);
    assert.equal(existsSync(running.socket.path), false);
    acquireFileLock(join(dirname(current), 'lock')).close();
  } finally {
    peer?.destroy();
    if (server.exitCode === null) {
      if (existsSync(boundary)) writeFileSync(release, 'release');
      else server.kill('SIGTERM');
      try {
        await pollUntil(async () => server.exitCode ?? undefined, { description: 'the test service exits', timeoutMs: 5000 });
      } catch {
        server.kill('SIGKILL');
      }
      await server.exited;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
