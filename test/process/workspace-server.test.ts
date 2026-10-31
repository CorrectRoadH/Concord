import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { installedConcordCli } from '../support/support.js';
import { tmpdir } from '../support/temporary.js';

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
