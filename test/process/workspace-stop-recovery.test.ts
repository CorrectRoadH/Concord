// Cross-process acceptance: real locks, computation pipes and service replacement.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { pollUntil } from '../support/support.ts';
import { command, fixture, record, recordPath, stop } from '../support/workspace-server-fixture.ts';

const childrenOf = (pid: number) => execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' }).split('\n').flatMap(line => {
  const row = line.trim().split(/\s+/u); return Number(row[1]) === pid ? [Number(row[0])] : [];
});
const kill = (pid: number, signal: NodeJS.Signals) => { try { process.kill(pid, signal); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause; } };

// @use-case docs/feature/local-data-engine/use-case/recover-workspace-service.md#replace
test('shutdown releases a service whose active computation cannot acknowledge interruption', { skip: process.platform === 'win32', timeout: 40_000 }, async () => {
  const root = await fixture(), boundary = join(root, 'computation-paused');
  const env = { ...process.env, CONCORD_TEST_COMPUTATION_PAUSED: boundary,
    BUN_OPTIONS: `${process.env.BUN_OPTIONS ?? ''} --preload=${fileURLToPath(new URL('../fixtures/computation-pause-preload.ts', import.meta.url))}`.trim() };
  let instance: ReturnType<typeof record> | undefined;
  let children: number[] = [];
  let query: ReturnType<typeof command> | undefined;
  try {
    assert.equal((await command(root, ['list', 'feature'], undefined, env)).status, 0);
    instance = record(root);
    children = childrenOf(instance.pid);
    writeFileSync(`${boundary}.armed`, 'armed');
    query = command(root, ['list', 'feature'], undefined, env);
    await pollUntil(async () => existsSync(boundary) ? true : undefined, { description: 'the real computation receives a request before being stopped' });
    assert.ok(children.includes(Number(readFileSync(boundary, 'utf8'))));
    rmSync(`${boundary}.armed`);
    const result = await command(root, ['server', 'stop']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(existsSync(recordPath(root)), false);
    assert.equal(existsSync(instance.socket.path), false);
    for (const pid of children) assert.throws(() => process.kill(pid, 0), /ESRCH|No such process/u);
    await query;
    const recovered = await command(root, ['list', 'feature']);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(recovered.stdout, /Reader/u);
    assert.notEqual(record(root).token, instance.token);
  } finally {
    if (instance && existsSync(recordPath(root)) && record(root).token === instance.token) {
      for (const pid of children) kill(pid, 'SIGKILL');
      kill(instance.pid, 'SIGKILL');
    }
    await query;
    await stop(root);
    rmSync(root, { recursive: true, force: true });
  }
});

// @use-case docs/feature/local-data-engine/use-case/recover-workspace-service.md#blocked
// @issue docs/issues/workspace-stop-idle-worker.md
test('an unresponsive live lock owner is not absent and prevents competing startup', { skip: process.platform === 'win32', timeout: 40_000 }, async () => {
  const root = await fixture();
  let instance: ReturnType<typeof record> | undefined;
  try {
    assert.equal((await command(root, ['list', 'feature'])).status, 0);
    instance = record(root);
    kill(instance.pid, 'SIGSTOP');
    const status = await command(root, ['server', 'status']);
    assert.equal(status.status, 1, status.stdout + status.stderr);
    const error = JSON.parse(status.stderr || status.stdout);
    assert.equal(error.error, 'CleanupFailed');
    assert.equal(error.details.pid, instance.pid);
    assert.equal(error.details.phase, 'handshake');
    const query = await command(root, ['list', 'feature']);
    assert.equal(query.status, 1, query.stdout + query.stderr);
    assert.equal(JSON.parse(query.stderr || query.stdout).error, 'CleanupFailed');
    assert.equal(record(root).token, instance.token);
  } finally {
    if (instance) kill(instance.pid, 'SIGCONT');
    try { await stop(root); }
    finally {
      if (instance && existsSync(recordPath(root)) && record(root).token === instance.token) {
        for (const pid of childrenOf(instance.pid)) kill(pid, 'SIGKILL');
        kill(instance.pid, 'SIGKILL');
        assert.equal((await command(root, ['server', 'stop'])).status, 0);
      }
      rmSync(root, { recursive: true, force: true });
    }
  }
});
