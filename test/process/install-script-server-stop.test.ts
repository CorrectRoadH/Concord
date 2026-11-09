// 跨进程保证：服务与 IPC——不同安装共享服务，只按 token 和命令作用域授权且不影响另一工作区。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { privateSourceInstallation } from '../support/private-source.ts';
import { command, fixture, record, rpcModule, stop } from '../support/workspace-server-fixture.ts';

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md#upgrade-running-service
test('different installations share data and cache requests while preserving token and scope authorization', { timeout: 45_000 }, async () => {
  const root = (await fixture()), other = (await fixture()), installation = mkdtempSync(join(tmpdir(), 'concord-installer-stop-'));
  const entry = privateSourceInstallation(installation);
  try {
    const startA = await command(root, ['server', 'start']); assert.equal(startA.status, 0, startA.stdout + startA.stderr);
    const startOther = await command(other, ['server', 'start']); assert.equal(startOther.status, 0, startOther.stdout + startOther.stderr);
    const before = record(root), unrelated = record(other), rpc = await rpcModule();
    const ready = await command(root, ['workspace', 'wait']);
    assert.equal(ready.status, 0, ready.stdout + ready.stderr);
    // Installation identity does not authorize data; the instance token does.
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const peer = yield* rpc.connectWorkspaceSocket(before.socket.path, 'another-installation', before.token);
      yield* rpc.requestWorkspace(peer, 'workspace', {});
      yield* rpc.requestWorkspace(peer, 'cache-snapshot', {});
      yield* rpc.submitFeedback(peer, 'fixture', []);
      const denied = yield* Effect.result(peer.client.workspace({ ...peer.identity(), token: 'another-token' }).pipe(rpc.collectPackets));
      assert.equal(denied._tag, 'Failure');
      const wrongScope = yield* Effect.result(peer.client.shutdown({ token: before.token, scope: 'foreign-command-scope' }));
      assert.equal(wrongScope._tag, 'Failure');
    })));
    const startB = await command(root, ['server', 'start'], entry); assert.equal(startB.status, 0, startB.stdout + startB.stderr);
    const shared = record(root); assert.equal(shared.installation, before.installation); assert.equal(shared.token, before.token);
    assert.equal(record(other).token, unrelated.token);
    const cache = await command(root, ['cache', 'status']); assert.equal(cache.status, 0, cache.stdout + cache.stderr);
    const returned = record(root); assert.equal(returned.installation, before.installation); assert.equal(returned.token, shared.token);
    assert.equal(record(other).token, unrelated.token);
    assert.equal((await command(root, ['list', 'feature'], entry)).status, 0);
    assert.equal((await command(root, ['server', 'stop'], entry)).status, 0);
  } finally {
    await stop(root); await stop(other);
    rmSync(root, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); rmSync(installation, { recursive: true, force: true });
  }
});
