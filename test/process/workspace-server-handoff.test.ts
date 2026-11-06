import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { Effect, Schema, Stream } from 'effect';
import { installationRootForBin } from '../../src/base/installation/index.ts';
import { installedConcordCli, pollUntil } from '../support/support.ts';
import { tmpdir } from '../support/temporary.ts';
import { startViewServer } from '../e2e/server.ts';
import { prepareSourceConsumer, sourceRoot } from '../support/source-consumer.ts';
import { sourceCli } from '../support/source-consumer.ts';
import { privateSourceInstallation } from '../support/private-source.ts';

import { recordPath, record, fixture, command, rpcModule, stop } from '../support/workspace-server-fixture.ts';

// @feature docs/feature/local-data-engine/README.md
test('C23 another installation reports a version conflict and preserves the existing service until explicit stop', { timeout: 30_000 }, async () => {
  const root = fixture(), installation = mkdtempSync(join(tmpdir(), 'concord-server-handoff-'));
  const old = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  try {
    privateSourceInstallation(installation);
    const installed = installation;
    const entry = sourceCli(installed);
    writeFileSync(join(dirname(entry), 'handoff-identity-fixture.ts'), 'export {};\n');
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


// @feature docs/engineering/build/architecture.md#从源码运行
test('source edits replace the same checkout service only after the previous owner exits', { timeout: 45_000 }, async () => {
  const root = fixture(), installation = mkdtempSync(join(tmpdir(), 'concord-source-reload-'));
  let entry = '';
  try {
    const tool = join(installation, 'source');
    entry = privateSourceInstallation(tool);
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
