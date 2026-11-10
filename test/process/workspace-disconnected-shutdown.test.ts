// 跨进程保证：服务与 IPC——进程暂停期间超时断开的真实客户端不能阻止服务释放子进程、socket 与锁。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import test from 'node:test';
import { command, fixture, record, recordPath, stop } from '../support/workspace-server-fixture.ts';

// @use-case docs/feature/local-data-engine/use-case/recover-workspace-service.md#replace
// @issue docs/issues/workspace-stop-idle-worker.md
test('timed-out disconnected clients cannot retain the service during shutdown', { skip: process.platform === 'win32', timeout: 40_000 }, async () => {
  const root = await fixture();
  let instance: ReturnType<typeof record> | undefined;
  let children: number[] = [];
  try {
    assert.equal((await command(root, ['list', 'feature'])).status, 0);
    instance = record(root);
    const pid = instance.pid;
    children = execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' }).split('\n').flatMap(line => {
      const row = line.trim().split(/\s+/u); return Number(row[1]) === pid ? [Number(row[0])] : [];
    });
    process.kill(pid, 'SIGSTOP');
    // The one-second public handshake deadline closes each actual client.
    for (let attempt = 0; attempt < 3; attempt++) await command(root, ['server', 'status']);
    await command(root, ['list', 'feature']);
    process.kill(pid, 'SIGCONT');
    const stopped = await command(root, ['server', 'stop']);
    assert.equal(stopped.status, 0, stopped.stdout + stopped.stderr);
    assert.equal(existsSync(recordPath(root)), false);
    assert.equal(existsSync(instance.socket.path), false);
    for (const child of children) assert.throws(() => process.kill(child, 0), /ESRCH|No such process/u);
    assert.equal((await command(root, ['list', 'feature'])).status, 0);
    assert.notEqual(record(root).token, instance.token);
  } finally {
    if (instance && existsSync(recordPath(root)) && record(root).token === instance.token) {
      for (const pid of [...children, instance.pid]) try { process.kill(pid, 'SIGKILL'); } catch { /* reaped */ }
      assert.equal((await command(root, ['server', 'stop'])).status, 0, 'forced fixture cleanup confirms lock release');
    } else await stop(root);
    rmSync(root, { recursive: true, force: true });
  }
});
