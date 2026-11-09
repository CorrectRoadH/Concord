// 跨进程保证：服务与 IPC——远程短查询结束后，托管服务与终端 CLI 双向复用同一实例。
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import test from 'node:test';
import { Effect } from 'effect';
import { ModSession, type ModHost } from '../../src/entry/herdr-mod/index.ts';
import { command, fixture, record, recordPath, stop } from '../support/workspace-server-fixture.ts';

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('waiting for a server handshake times out without creating a service', { timeout: 20_000 }, async () => {
  const root = await fixture();
  try {
    const reply = await command(root, ['server', 'status', '--wait']);
    assert.notEqual(reply.status, 0);
    assert.equal(JSON.parse(reply.stderr).error, 'WorkspaceServerUnavailable');
    assert.equal(existsSync(recordPath(root)), false);
    assert.equal(JSON.parse((await command(root, ['server', 'status'])).stdout).state, 'absent');
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});

// Only Herdr's exec/run ownership boundary is simulated; every Concord call,
// server, handshake, projection and shutdown uses the actual public CLI.
// @use-case docs/feature/herdr-mod/use-case/use-on-remote-machine.md#open
// @issue docs/issues/herdr-remote-service-lifetime.md
test('remote cold reads survive short-command cleanup and terminal queries reuse their hosted service', { timeout: 30_000 }, async () => {
  const root = await fixture();
  let serving: ReturnType<typeof command> | undefined;
  let projections = 0;
  const host: ModHost = { exec: async (program, args, options) => {
    assert.deepEqual(options, { cwd: root, on: 'vps' });
    if (program === 'hc') {
      assert.deepEqual(args, ['run', '--bg', '--no-parent', '--rm', '--', 'concord', 'server', 'run', '--root', root]);
      serving = command(root, ['server', 'run']);
      return { code: 0, stdout: '{"address":"hosted"}', stderr: '' };
    }
    assert.equal(program, 'concord');
    const operation = args.slice(args.indexOf('--root') + 2);
    if (operation[1] === 'projection' && ++projections > 3) return { code: 1, stdout: '', stderr: JSON.stringify({ error: 'ProbeLimit', message: 'No persistent service after three reads' }) };
    const reply = await command(root, operation);
    // The external executor reclaims children born in the short invocation.
    if (serving === undefined && existsSync(recordPath(root))) await stop(root);
    return { code: reply.status ?? -1, stdout: reply.stdout, stderr: reply.stderr };
  } };
  const session = new ModSession(host, root, 'vps');
  try {
    await Effect.runPromise(session.refresh());
    assert.ok(session.documents.some(document => document.path === 'docs/feature/reader/README.md'));
    assert.ok(serving, 'the host owns a foreground server');
    const hosted = record(root);
    const terminal = await command(root, ['workspace', 'projection']);
    assert.equal(terminal.status, 0, terminal.stderr);
    assert.equal(record(root).pid, hosted.pid);
    assert.equal(record(root).token, hosted.token);
    session.stop();
    assert.equal((await command(root, ['server', 'status'])).status, 0);
    assert.equal(record(root).pid, hosted.pid, 'closing the mod does not stop the shared service');
  } finally {
    session.stop(); await stop(root);
    if (serving) assert.equal((await serving).status, 0);
    rmSync(root, { recursive: true, force: true });
  }
});

// @use-case docs/feature/herdr-mod/use-case/use-on-remote-machine.md#open
test('remote mod reuses a service started directly by a terminal', { timeout: 30_000 }, async () => {
  const root = await fixture();
  try {
    const initial = await command(root, ['workspace', 'wait', '--timeout', '10']);
    assert.equal(initial.status, 0, initial.stderr);
    const original = record(root);
    const session = new ModSession({ exec: async (program, args) => {
      assert.equal(program, 'concord', 'an existing service requires no hosting terminal');
      const reply = await command(root, args.slice(args.indexOf('--root') + 2));
      return { code: reply.status ?? -1, stdout: reply.stdout, stderr: reply.stderr };
    } }, root, 'vps');
    const waiting = await Effect.runPromise(session.wait());
    assert.equal(waiting.changed, true);
    await Effect.runPromise(session.refresh());
    assert.equal(record(root).pid, original.pid);
    assert.equal(record(root).token, original.token);
    session.stop();
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});
