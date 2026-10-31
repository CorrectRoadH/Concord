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
import { installConcord, packConcord } from '../support/installed-package.js';

import { recordPath, record, fixture, command, rpcModule, stop } from '../support/workspace-server-fixture.js';

// @feature docs/feature/web-workbench/README.md
// @issue docs/issues/workspace-server-unimplemented.md
test('disconnecting a view client releases its HTTP lease while the service remains available', { timeout: 20_000 }, async () => {
  const root = fixture();
  try {
    assert.equal((await command(root, ['server', 'start'])).status, 0);
    const running = record(root), rpc = await rpcModule();
    let address = '';
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const connection = yield* rpc.connectWorkspaceSocket(running.socket.path, running.installation, running.token);
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
// @issue docs/issues/workspace-server-unimplemented.md
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
// @issue docs/issues/workspace-server-unimplemented.md
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
// @issue docs/issues/workspace-server-unimplemented.md
test('C23 another installation waits for native ownership handoff and the old Web connection receives stopping', { timeout: 30_000 }, async () => {
  const root = fixture(), installation = mkdtempSync(join(tmpdir(), 'concord-server-handoff-'));
  const old = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  try {
    writeFileSync(join(installation, 'package.json'), JSON.stringify({ private: true }));
    installConcord(installation, packConcord(installation), [], { private: true });
    const installed = join(installation, 'node_modules/concord-sdlc');
    writeFileSync(join(installed, 'dist/handoff-identity-fixture.js'), 'export {};\n');
    const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
    const entry = join(installed, manifest.bin.concord);
    const before = record(root);
    const events = await fetch(new URL('api/events', old.address), { signal: AbortSignal.timeout(15_000) });
    const stopping = (async () => {
      let output = '';
      for await (const chunk of events.body!) { output += new TextDecoder().decode(chunk); if (output.includes('event: stopping')) return true; }
      return false;
    })();
    const started = await command(root, ['server', 'start'], entry);
    assert.equal(started.status, 0, started.stderr);
    const after = record(root);
    assert.notEqual(after.token, before.token);
    assert.notEqual(after.installation, before.installation);
    assert.equal(await stopping, true);
    assert.equal((await command(root, ['list', 'feature'], entry)).status, 0);
    await command(root, ['server', 'stop'], entry);
    await pollUntil(async () => !existsSync(recordPath(root)) ? true : undefined, { description: 'replacement service releases ownership', timeoutMs: 8000 });
  } finally { await old.close(); await stop(root); rmSync(root, { recursive: true, force: true }); rmSync(installation, { recursive: true, force: true }); }
});
