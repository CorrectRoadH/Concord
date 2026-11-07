// 跨进程保证：服务与 IPC——socket写入失败在RPC边界返回具名错误，不能逃逸为运行时defect。
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { Socket } from 'node:net';
import test from 'node:test';
import { Effect } from 'effect';
import { command, fixture, record, rpcModule, stop } from '../support/workspace-server-fixture.ts';

// @feature docs/feature/local-data-engine/README.md
// @issue docs/issues/bun-socket-diagnostic.md
test('a socket write defect becomes a named transport failure during derivation submission', { timeout: 30_000 }, async t => {
  const root = (await fixture());
  try {
    const started = await command(root, ['server', 'start']);
    assert.equal(started.status, 0, started.stderr);
    const owner = record(root), rpc = await rpcModule();
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const connection = yield* rpc.connectWorkspaceSocket(owner.socket.path, owner.installation, owner.token);
      const write = t.mock.method(Socket.prototype, 'write', () => { throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }); });
      try {
        const result = yield* Effect.result(rpc.submitDerivations(connection, [{ namespace: 'annotation_cache', entries: [{ key: 'fault', payload: '{}' }] }]));
        assert.equal(result._tag, 'Failure');
        if (result._tag === 'Failure') {
          assert.ok(result.failure instanceof rpc.WorkspaceServerError);
          assert.equal(result.failure.code, 'WorkspaceServerUnavailable');
          assert.match(result.failure.message, /EPIPE/u);
        }
      } finally { write.mock.restore(); }
    })));
  } finally {
    await stop(root);
    rmSync(root, { recursive: true, force: true });
  }
});
