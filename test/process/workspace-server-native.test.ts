// 跨进程保证：原生模块与句柄——运行服务重验真实native工件后降级，修复后同token重新打开持久owner。
import { privateSourceInstallation } from '../support/private-source.ts';
import { installationResources } from '../support/source-resources.ts';
import assert from 'node:assert/strict';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import test from 'node:test';
import { Effect, Schema, Stream } from 'effect';
import { prepareSourceConsumer, sourceRoot } from '../support/source-consumer.ts';
import { pollUntil } from '../support/support.ts';
import { tmpdir } from '../support/temporary.ts';
import { command, fixture, record, rpcModule, stop } from '../support/workspace-server-fixture.ts';

// @feature docs/feature/local-data-engine/README.md
test('runtime native validation degrades the locked service and a repaired artifact reopens its persistent owner', { timeout: 30_000 }, async () => {
  const root = fixture(), install = mkdtempSync(join(tmpdir(), 'concord-server-native-'));
  let metadata = '', hidden = '';
  try {
    privateSourceInstallation(install);
    const packageRoot = install;
    const entry = installationResources(packageRoot).bin;
    const native = installationResources(packageRoot).native;
    metadata = join(native, readdirSync(native)[0]!, 'artifact.json'); hidden = `${metadata}.hidden`;
    assert.equal((await command(root, ['server', 'start'], entry)).status, 0);
    const running = record(root), rpc = await rpcModule();
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const connection = yield* rpc.connectWorkspaceSocket(running.socket.path, running.installation, running.token);
      let last: unknown;
      yield* Effect.forkScoped(Stream.runForEach(rpc.subscribeWorkspace(connection), value => Effect.sync(() => {
        last = Schema.decodeUnknownSync(Schema.Struct({ state: Schema.String, error: Schema.optional(Schema.Struct({ code: Schema.String, message: Schema.String })) }))(value);
      })));
      const hello = () => Effect.runPromise(connection.client.hello({ protocol: rpc.PROTOCOL, installation: running.installation }));
      yield* Effect.promise(() => pollUntil(async () => (await hello()).state === 'running' ? true : undefined, { description: 'initial native owner opens', timeoutMs: 5000 }));
      renameSync(metadata, hidden);
      try {
        yield* Effect.promise(() => pollUntil(async () => (await hello()).state === 'degraded' ? true : undefined, { description: 'native artifact is revalidated after service startup', timeoutMs: 3500 }));
        assert.equal(record(root).token, running.token);
      } finally { renameSync(hidden, metadata); }
      yield* Effect.tryPromise({ try: () => pollUntil(async () => (await hello()).state === 'running' ? true : undefined, { description: 'repaired artifact reopens the same service', timeoutMs: 5000 }), catch: cause => new Error(`${String(cause)}; last state: ${JSON.stringify(last)}`) });
      assert.equal(record(root).token, running.token);
    })));
  } finally {
    if (hidden) { try { renameSync(hidden, metadata); } catch { /* already repaired */ } }
    await stop(root); rmSync(root, { recursive: true, force: true }); rmSync(install, { recursive: true, force: true });
  }
});
