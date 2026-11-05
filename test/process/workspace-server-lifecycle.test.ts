import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { Effect, Schema, Stream } from 'effect';
import { installationRootForBin } from '../../src/base/installation/index.js';
import { installedConcordCli, pollUntil } from '../support/support.js';
import { tmpdir } from '../support/temporary.js';
import { startViewServer } from '../e2e/server.js';
import { prepareSourceConsumer, sourceConcord } from '../support/installed-package.js';

import { recordPath, record, fixture, command, rpcModule, stop } from '../support/workspace-server-fixture.js';

// @feature docs/feature/web-workbench/README.md
test('disconnecting a view client releases its HTTP lease while the service remains available', { timeout: 20_000 }, async () => {
  const root = fixture();
  try {
    assert.equal((await command(root, ['server', 'start'])).status, 0);
    const running = record(root), rpc = await rpcModule();
    let address = '';
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const connection = yield* rpc.connectWorkspaceSocket(running.socket.path, running.installation, running.token);
      yield* Effect.promise(() => pollUntil(async () => {
        const hello = await Effect.runPromise(connection.client.hello({ protocol: rpc.PROTOCOL, installation: running.installation }));
        return ['running', 'degraded'].includes(hello.state) ? true : undefined;
      }, { description: 'the real service admits HTTP leases after opening', timeoutMs: 10_000 }));
      const lease = yield* rpc.requestWorkspace(connection, 'http', { action: 'open', host: '127.0.0.1', port: 0 });
      address = Schema.decodeUnknownSync(Schema.Struct({ address: Schema.String }))(lease).address;
      assert.ok((yield* Effect.promise(() => fetch(address))).ok);
    })));
    await pollUntil(async () => {
      try { await fetch(address, { signal: AbortSignal.timeout(500) }); return undefined; }
      catch { return true; }
    }, { description: 'disconnected view releases its listener', timeoutMs: 1500 });
    assert.equal((await command(root, ['server', 'status'])).status, 0);
    assert.equal(record(root).token, running.token);
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
test('a killed service releases persistent ownership and the next invocation can restart', { timeout: 30_000 }, async () => {
  const root = fixture();
  try {
    const started = await command(root, ['server', 'start']); assert.equal(started.status, 0, started.stderr);
    const before = record(root); process.kill(before.pid, 'SIGKILL');
    const read = await command(root, ['list', 'feature']); assert.equal(read.status, 0, read.stderr);
    const restarted = await command(root, ['server', 'start']); assert.equal(restarted.status, 0, restarted.stderr);
    assert.notEqual(record(root).token, before.token);
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
test('C22 deleting the Git-private directory stops the service and removes its exact socket', { timeout: 20_000 }, async () => {
  const root = fixture();
  let running: ReturnType<typeof record> | undefined;
  try {
    assert.equal((await command(root, ['server', 'start'])).status, 0);
    running = record(root);
    rmSync(join(root, '.git/concord'), { recursive: true, force: true });
    const started = performance.now();
    await pollUntil(async () => !existsSync(running!.socket.path) ? true : undefined, { description: 'service cleanup after Git-private directory deletion', timeoutMs: 6500 });
    assert.ok(performance.now() - started < 5500);
    assert.equal(existsSync(recordPath(root)), false);
  } finally {
    if (running && existsSync(running.socket.path)) try { process.kill(running.pid, 'SIGTERM'); } catch { /* already stopped */ }
    rmSync(root, { recursive: true, force: true });
  }
});

// @feature docs/feature/local-data-engine/README.md
test('C23 another installation reports a version conflict and preserves the existing service until explicit stop', { timeout: 30_000 }, async () => {
  const root = fixture(), installation = mkdtempSync(join(tmpdir(), 'concord-server-handoff-'));
  const old = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  try {
    writeFileSync(join(installation, 'package.json'), JSON.stringify({ private: true }));
    prepareSourceConsumer(installation, sourceConcord(), [], { private: true });
    const installed = join(installation, 'node_modules/concord-sdlc');
    writeFileSync(join(installed, 'src/handoff-identity-fixture.ts'), 'export {};\n');
    const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
    const entry = join(installed, 'src/entry/cli/entry.ts');
    const before = record(root);
    for (const args of [['server', 'start'], ['check']]) {
      const rejected = await command(root, args, entry);
      assert.equal(rejected.status, 1, rejected.stdout);
      assert.equal(JSON.parse(rejected.stderr).error, 'WorkspaceServerVersionConflict');
      assert.equal(record(root).token, before.token);
    }
    assert.equal((await fetch(old.address, { headers: { connection: 'close' } })).ok, true);
    assert.equal((await command(root, ['server', 'stop'], entry)).status, 0);
    await pollUntil(async () => !existsSync(recordPath(root)) ? true : undefined, { description: 'explicit stop releases the previous service', timeoutMs: 8000 });
    const started = await command(root, ['server', 'start'], entry); assert.equal(started.status, 0, started.stderr);
    const after = record(root);
    assert.notEqual(after.token, before.token);
    assert.notEqual(after.installation, before.installation);
    assert.equal((await command(root, ['list', 'feature'], entry)).status, 0);
    await command(root, ['server', 'stop'], entry);
    await pollUntil(async () => !existsSync(recordPath(root)) ? true : undefined, { description: 'replacement service releases ownership', timeoutMs: 8000 });
  } finally { await old.close(); await stop(root); rmSync(root, { recursive: true, force: true }); rmSync(installation, { recursive: true, force: true }); }
});

// @feature docs/engineering/concord-self-hosting/README.md
test('source edits replace the same checkout service only after the previous owner exits', { timeout: 45_000 }, async () => {
  const root = fixture(), installation = mkdtempSync(join(tmpdir(), 'concord-source-reload-'));
  let entry = '';
  try {
    writeFileSync(join(installation, 'package.json'), JSON.stringify({ private: true }));
    prepareSourceConsumer(installation, sourceConcord(), [], { private: true });
    const tool = join(installation, 'node_modules/concord-sdlc');
    entry = join(tool, 'src/entry/cli/entry.ts');
    const start = await command(root, ['server', 'start'], entry);
    assert.equal(start.status, 0, start.stderr);
    const before = record(root);
    writeFileSync(join(tool, 'src/source-reload-fixture.ts'), 'export {};\n');
    const query = await command(root, ['list', 'feature'], entry);
    assert.equal(query.status, 0, query.stderr);
    const after = record(root);
    assert.notEqual(after.token, before.token);
    assert.equal(after.installation, before.installation);
    assert.notEqual(after.sourceDigest, before.sourceDigest);
    assert.equal((await command(root, ['server', 'stop'], entry)).status, 0);
    assert.equal(existsSync(recordPath(root)), false);
  } finally { if (entry) await command(root, ['server', 'stop'], entry); rmSync(root, { recursive: true, force: true }); rmSync(installation, { recursive: true, force: true }); }
});
