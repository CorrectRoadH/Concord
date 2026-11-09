// 跨进程保证：原生模块与句柄——运行服务重验真实native工件后降级，修复后同token重新打开持久owner。
import { privateSourceInstallation } from '../support/private-source.ts';
import { installationResources } from '../support/source-resources.ts';
import { hawdbTarget } from '../../src/base/installation/index.ts';
import assert from 'node:assert/strict';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema, Stream } from 'effect';
import { prepareSourceConsumer, sourceRoot } from '../support/source-consumer.ts';
import { pollUntil } from '../support/support.ts';
import { tmpdir } from '../support/temporary.ts';
import { command, fixture, record, rpcModule, stop } from '../support/workspace-server-fixture.ts';

// @feature docs/feature/local-data-engine/README.md
test('runtime native validation degrades the locked service and a repaired artifact reopens its persistent owner', { timeout: 30_000 }, async () => {
  const root = (await fixture()), install = mkdtempSync(join(tmpdir(), 'concord-server-native-'));
  let metadata = '', hidden = '';
  const failures: unknown[] = [];
  try {
    privateSourceInstallation(install);
    const packageRoot = install;
    const entry = installationResources(packageRoot).bin;
    const native = installationResources(packageRoot).native;
    metadata = join(native, hawdbTarget(), 'artifact.json'); hidden = `${metadata}.hidden`;
    assert.equal((await command(root, ['server', 'start'], entry)).status, 0);
    const running = record(root), rpc = await rpcModule();
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const connection = yield* rpc.connectWorkspaceSocket(running.socket.path, running.installation, running.token);
      let last: unknown;
      // Startup includes context restoration as well as native opening. Await
      // its published state; this recovery test has no cold-start latency budget.
      const initial = yield* rpc.subscribeWorkspace(connection).pipe(
        Stream.map(value => Schema.decodeUnknownSync(Schema.Struct({ state: Schema.String, error: Schema.optional(Schema.Struct({ code: Schema.String, message: Schema.String })) }))(value)),
        Stream.filter(value => value.state !== 'opening'), Stream.take(1), Stream.runCollect,
      );
      assert.equal(initial[0]?.state, 'running', JSON.stringify(initial));
      const hello = async () => {
        const value = await Effect.runPromise(connection.client.hello({ protocol: rpc.PROTOCOL, installation: running.installation }));
        last = value;
        return value;
      };
      renameSync(metadata, hidden);
      try {
        yield* Effect.promise(() => pollUntil(async () => (await hello()).state === 'degraded' ? true : undefined, { description: 'native artifact is revalidated after service startup', timeoutMs: 3500 }));
        assert.equal(record(root).token, running.token);
      } finally { renameSync(hidden, metadata); }
      yield* Effect.tryPromise({ try: () => pollUntil(async () => (await hello()).state === 'running' ? true : undefined, { description: 'repaired artifact reopens the same service', timeoutMs: 5000 }), catch: cause => new Error(`${String(cause)}; last state: ${JSON.stringify(last)}`) });
      assert.equal(record(root).token, running.token);
    })));
  } catch (cause) { failures.push(cause); } finally {
    const cleanup: unknown[] = [];
    if (hidden) {
      try { renameSync(hidden, metadata); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') cleanup.push(cause); }
    }
    try { await stop(root); } catch (cause) { cleanup.push(cause); }
    failures.push(...cleanup);
    if (cleanup.length === 0) {
      for (const path of [root, install]) {
        try { rmSync(path, { recursive: true, force: true }); } catch (cause) { failures.push(cause); }
      }
    }
  }
  if (failures.length) throw new AggregateError(failures, `Native validation fixture failed; root: ${root}; installation: ${install}`);
});
