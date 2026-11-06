// 跨进程保证：服务与 IPC——真实RPC分帧提交完整派生缓存，断连未完成会话被丢弃且不能写历史结果命名空间。
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { command, fixture, record, rpcModule, stop } from '../support/workspace-server-fixture.ts';

// @feature docs/feature/local-data-engine/README.md
test('local cache derivations cross real frames, abandon disconnected input, and cannot replace historical results', { timeout: 30_000 }, async () => {
  const root = fixture();
  try {
    assert.equal((await command(root, ['check'])).status, 0);
    const running = record(root), rpc = await rpcModule();
    const key = `cache-bridge:${crypto.randomUUID()}`, payload = JSON.stringify({ body: 'x'.repeat(600 * 1024) });
    const batches = [{ namespace: 'annotation_cache' as const, entries: [{ key, payload }] }];
    const bytes = Buffer.from(JSON.stringify(batches));
    const session = crypto.randomUUID();
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const connection = yield* rpc.connectWorkspaceSocket(running.socket.path, running.installation, running.token);
      yield* rpc.requestWorkspace(connection, 'cache-derived', { action: 'begin', session });
      yield* rpc.requestWorkspace(connection, 'cache-derived', { action: 'append', session, data: bytes.subarray(0, 128) });
    })));
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const connection = yield* rpc.connectWorkspaceSocket(running.socket.path, running.installation, running.token);
      const snapshot = () => rpc.requestWorkspace(connection, 'cache-snapshot', {}).pipe(Effect.flatMap(value => Schema.decodeUnknownEffect(rpc.Snapshot)(value)));
      assert.equal((yield* snapshot()).annotation_cache?.some(row => row.key === key), false);
      const unknown = yield* Effect.result(rpc.requestWorkspace(connection, 'cache-derived', { action: 'commit', session }));
      assert.equal(unknown._tag, 'Failure');
      yield* rpc.submitDerivations(connection, batches);
      assert.equal((yield* snapshot()).annotation_cache?.find(row => row.key === key)?.payload === payload, true);
      const forbidden = yield* Effect.result(rpc.submitDerivations(connection, [{ namespace: 'query_cache', entries: [{ key: 'historical-not-authorized', payload: '{}' }] }]));
      assert.equal(forbidden._tag, 'Failure');
      assert.equal((yield* snapshot()).query_cache?.some(row => row.key === 'historical-not-authorized'), false);
    })));
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});
