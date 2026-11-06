// 跨进程保证：服务与 IPC——不同安装通过真实RPC停止指定工作区服务，拒绝错误身份且不影响另一工作区。
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { privateSourceInstallation } from '../support/private-source.ts';
import { pollUntil } from '../support/support.ts';
import { command, fixture, record, recordPath, rpcModule, stop } from '../support/workspace-server-fixture.ts';

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md#upgrade-running-service
test('explicit stop from another installation preserves data and scope authorization and stops only the selected project', { timeout: 45_000 }, async () => {
  const root = fixture(), other = fixture(), installation = mkdtempSync(join(tmpdir(), 'concord-installer-stop-'));
  const entry = privateSourceInstallation(installation);
  try {
    const startA = await command(root, ['server', 'start']); assert.equal(startA.status, 0, startA.stdout + startA.stderr);
    const startOther = await command(other, ['server', 'start']); assert.equal(startOther.status, 0, startOther.stdout + startOther.stderr);
    const before = record(root), unrelated = record(other), rpc = await rpcModule();
    for (const args of [['server', 'start'], ['list', 'feature']]) {
      const conflict = await command(root, args, entry); assert.equal(conflict.status, 1, conflict.stdout + conflict.stderr);
      assert.match(conflict.stderr, /WorkspaceServerVersionConflict/);
      assert.match(conflict.stderr, /Stop it with: concord server stop/);
      assert.equal(record(root).token, before.token);
    }
    // Control-frame support does not authorize a data frame with another identity.
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const peer = yield* rpc.connectWorkspaceSocket(before.socket.path, 'another-installation', before.token);
      const denied = yield* Effect.result(rpc.requestWorkspace(peer, 'workspace', {}));
      assert.equal(denied._tag, 'Failure');
      const wrongScope = yield* Effect.result(peer.client.shutdown({ token: before.token, scope: 'foreign-command-scope' }));
      assert.equal(wrongScope._tag, 'Failure');
    })));
    const stopped = await command(root, ['server', 'stop'], entry); assert.equal(stopped.status, 0, stopped.stdout + stopped.stderr);
    await pollUntil(async () => !existsSync(recordPath(root)) ? true : undefined, { description: 'cross-install stop releases the selected server', timeoutMs: 8000 });
    assert.equal(record(other).token, unrelated.token);
    const startB = await command(root, ['server', 'start'], entry); assert.equal(startB.status, 0, startB.stdout + startB.stderr);
    const replacement = record(root); assert.notEqual(replacement.installation, before.installation); assert.notEqual(replacement.token, before.token);
    assert.equal((await command(root, ['list', 'feature'], entry)).status, 0);
    assert.equal((await command(root, ['server', 'stop'], entry)).status, 0);
  } finally {
    await stop(root); await stop(other);
    rmSync(root, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); rmSync(installation, { recursive: true, force: true });
  }
});
