// 跨进程保证：服务与 IPC——真实缓存维护关闭再打开服务持久owner并发布新generation，同token同时支持读写和HTTP重建。
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { Effect, Schema, Stream } from 'effect';
import { installationRootForBin } from '../../src/base/installation/index.ts';
import { installedConcordCli, pollUntil } from '../support/support.ts';
import { tmpdir } from '../support/temporary.ts';
import { startViewServer } from '../e2e/server.ts';
import { prepareSourceConsumer, sourceRoot } from '../support/source-consumer.ts';

import { recordPath, record, fixture, command, rpcModule, stop } from '../support/workspace-server-fixture.ts';

// @feature docs/feature/local-data-engine/README.md
test('CLI cache clear drains the running persistent owner and publishes a new generation under the same service token', { timeout: 25_000 }, async () => {
  const root = fixture();
  try {
    assert.equal((await command(root, ['server', 'start'])).status, 0);
    const previous = await pollUntil(async () => {
      const result = await command(root, ['workspace', 'projection']);
      return result.status === 0 ? JSON.parse(result.stdout) : undefined;
    }, { description: 'initial generation before clear', timeoutMs: 8000 });
    const token = record(root).token;
    const cleared = await command(root, ['cache', 'clear']);
    assert.equal(cleared.status, 0, cleared.stderr);
    assert.equal(record(root).token, token);
    await pollUntil(async () => {
      const result = await command(root, ['workspace', 'projection']);
      if (result.status !== 0) return undefined;
      const value = JSON.parse(result.stdout);
      return value.projection.builtAt !== previous.projection.builtAt ? value : undefined;
    }, { description: 'new accepted generation after owner clear and reopen', timeoutMs: 8000 });
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
test('C21 current query commands and a local writer share the persistent owner without busy failures', { timeout: 45_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-server-queries-'));
  execFileSync('git', ['init', '-q', root]);
  try {
    const initialized = await command(root, ['init', '--docs-only']);
    assert.equal(initialized.status, 0, initialized.stderr);
    assert.equal((await command(root, ['server', 'start'])).status, 0);
    const simultaneous = await Promise.all([
      command(root, ['list', 'feature']), command(root, ['config', 'show']),
      command(root, ['taste']), command(root, ['test', 'list']),
      command(root, ['new', 'feature', 'service-query', '--title', 'Service query']),
    ]);
    for (const reply of simultaneous) assert.equal(reply.status, 0, reply.stderr);
    const current = await command(root, ['list', 'feature']);
    assert.equal(current.status, 0, current.stderr);
    assert.equal(JSON.parse(current.stdout).documents.some((value: { id: string }) => value.id === 'service-query'), true);

  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
test('HTTP cache status and forced rebuild use the persistent workspace owner', { timeout: 30_000 }, async () => {
  const root = fixture();
  try {
    const started = await command(root, ['server', 'start']); assert.equal(started.status, 0, started.stderr);
    const running = record(root), rpc = await rpcModule();
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const connection = yield* rpc.connectWorkspaceSocket(running.socket.path, running.installation, running.token);
      yield* Effect.promise(() => pollUntil(async () => {
        try { await Effect.runPromise(rpc.requestWorkspace(connection, 'workspace', {})); return true; } catch { return undefined; }
      }, { description: 'accepted workspace before HTTP maintenance', timeoutMs: 10_000 }));
      const listener = Schema.decodeUnknownSync(Schema.Struct({ address: Schema.String }))(yield* rpc.requestWorkspace(connection, 'http', { action: 'open', host: '127.0.0.1', port: 0 }));
      const action = (name: string) => Effect.tryPromise({ try: async () => {
        const response = await fetch(new URL('/api/action', listener.address), { method: 'POST', headers: { 'Content-Type': 'application/json', Connection: 'close' }, body: JSON.stringify({ action: name }) });
        const body: unknown = await response.json();
        assert.equal(response.status, 200, JSON.stringify(body));
        return body;
      }, catch: cause => cause });
      const status = Schema.decodeUnknownSync(Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({ status: Schema.Literal('ready'), sourceDigest: Schema.String }) }))(yield* action('cache.status'));
      assert.equal(status.value.status, 'ready');
      const accepted = Schema.decodeUnknownSync(Schema.Struct({ projection: Schema.Struct({ sourceDigest: Schema.String }) }))(yield* rpc.requestWorkspace(connection, 'workspace', {}));
      assert.equal(status.value.sourceDigest, accepted.projection.sourceDigest);
      const rebuilt = Schema.decodeUnknownSync(Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({ cache: Schema.Struct({ status: Schema.Literal('miss') }), codeCache: Schema.Struct({ status: Schema.Literals(['miss', 'hit']) }), cacheStatus: Schema.Struct({ status: Schema.Literal('ready') }) }) }))(yield* action('cache.rebuild'));
      assert.equal(rebuilt.value.cache.status, 'miss', 'an explicit rebuild recomputes even an already accepted annotation generation');
      assert.equal(record(root).token, running.token);
      assert.equal(record(root).pid, running.pid);
    })));
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});
