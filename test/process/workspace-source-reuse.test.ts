// 跨进程保证：服务与 IPC——同协议的来源变化不授权停止共享服务，显式 stop 仍回收它。
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { privateSourceInstallation } from '../support/private-source.ts';
import { command, fixture, record, stop } from '../support/workspace-server-fixture.ts';

// @feature docs/feature/local-data-engine/README.md
test('native collection reuses a same-protocol shared service after its source installation changes', { timeout: 45000 }, async () => {
  const root = await fixture(), installation = mkdtempSync(join(tmpdir(), 'concord-source-reuse-'));
  const entry = privateSourceInstallation(installation);
  try {
    const started = await command(root, ['server', 'start'], entry);
    assert.equal(started.status, 0, started.stdout + started.stderr);
    const before = record(root);
    appendFileSync(join(installation, 'src/entry/cli/cli-command-test.ts'), '\n// private source change after service startup\n');
    const result = await command(root, ['test', 'discover'], entry);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).observations, []);
    assert.equal(record(root).token, before.token, 'same protocol keeps the running service even when its source bytes change');
    assert.equal(record(root).pid, before.pid);
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); rmSync(installation, { recursive: true, force: true }); }
});
