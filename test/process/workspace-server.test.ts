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

// @feature docs/feature/local-data-engine/README.md
// @issue docs/issues/workspace-server-unimplemented.md
test('workspace server status observes absence without starting a service', () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-server-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const reply = spawnSync(process.execPath, [installedConcordCli(), '--root', root, '--json', 'server', 'status'], { encoding: 'utf8' });
    assert.equal(reply.status, 0, reply.stderr);
    assert.deepEqual(JSON.parse(reply.stdout), { operation: 'server-status', state: 'absent' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
// @issue docs/issues/workspace-server-unimplemented.md
test('workspace service publishes its initial computation and serves the accepted projection to CLI readers', { timeout: 25_000 }, async () => {
  const root = fixture();
  try {
    const started = await command(root, ['server', 'start']);
    assert.equal(started.status, 0, started.stderr);
    const projection = await pollUntil(async () => {
      const result = await command(root, ['workspace', 'projection']);
      if (result.status !== 0) return undefined;
      const value = JSON.parse(result.stdout);
      return value.projection.status === 'ready' && value.projection.consistent ? value : undefined;
    }, { description: 'initial computation accepted by the persistent owner and readable through CLI', timeoutMs: 10_000 });
    assert.equal(projection.operation, 'workspace-projection');
    assert.equal(projection.projection.refreshOwner, 'active');
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
// @issue docs/issues/workspace-server-unimplemented.md
test('concurrent starters share one real service and shutdown removes its record and socket', { timeout: 30_000 }, async () => {
  const root = fixture();
  try {
    const starts = await Promise.all([command(root, ['server', 'start']), command(root, ['server', 'start'])]);
    for (const result of starts) assert.equal(result.status, 0, result.stderr);
    const tokens = starts.map(result => JSON.parse(result.stdout).token);
    assert.equal(tokens[0], tokens[1]);
    const running = record(root);
    assert.equal(running.token, tokens[0]);
    assert.equal((await command(root, ['list', 'feature'])).status, 0);
    await stop(root);
    assert.equal(existsSync(running.socket.path), false);
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
// @issue docs/issues/workspace-server-unimplemented.md
test('binary socket reads preserve a source larger than one frame and reject mismatched instance tokens', { timeout: 30_000 }, async () => {
  const root = fixture();
  const source = `# Reader\n\n${'raw bytes 原文 '.repeat(90_000)}\n`;
  writeFileSync(join(root, 'docs/feature/reader/large.md'), source);
  try {
    const started = await command(root, ['server', 'start']); assert.equal(started.status, 0, started.stderr);
    const running = record(root), rpc = await rpcModule();
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const connection = yield* rpc.connectWorkspaceSocket(running.socket.path, running.installation, running.token);
      const read = yield* rpc.requestWorkspace(connection, 'read', { path: 'docs/feature/reader/large.md', expectedDigest: 'old-generation' });
      assert.equal(read.body, source);
      const rejected = yield* Effect.result(connection.client.hello({ protocol: 'concord.workspace/v1', installation: 'different-installation' }));
      assert.equal(rejected._tag, 'Success', 'hello remains available across installation identities');
      const invalid = yield* Effect.result(connection.client.shutdown({ token: 'other-instance' }));
      assert.equal(invalid._tag, 'Failure');
    })));
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});
