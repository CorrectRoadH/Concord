// 跨进程保证：服务与 IPC——停止服务时升级终止不响应 SIGTERM 的操作子进程并确认资源已释放。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import test from 'node:test';
import { pollUntil } from '../support/support.ts';
import { command, fixture, record, recordPath, stop } from '../support/workspace-server-fixture.ts';

// @feature docs/feature/local-data-engine/architecture.md#退出
// @issue docs/issues/workspace-stop-idle-worker.md
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
        if (row && Number(row[2]) === running.pid && /\/entry\/server\/operation-worker\.ts(?:\s|$)/u.test(row[3]!)) return Number(row[1]);
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
