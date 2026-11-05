import { stopWorkspaceServer } from '../support/stop-workspace-server.js';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { installedConcordCli } from '../support/support.js';
import { tmpdir } from '../support/temporary.js';

// @use-case docs/feature/herdr-mod/use-case/follow-changes.md
test('the native mod reads and refreshes through the public CLI and a shared workspace server', { timeout: 90_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-herdr-mod-'));
  const cli = installedConcordCli();
  try {
    execFileSync('git', ['init', '-q', root]);
    for (const args of [['init', '--yes'], ['new', 'feature', 'measured', '--title', 'measured']]) {
      const reply = spawnSync(process.execPath, [cli, '--root', root, '--json', ...args], { encoding: 'utf8', timeout: 30_000 });
      assert.equal(reply.status, 0, reply.stdout + reply.stderr);
    }
    const path = join(root, 'docs/feature/measured/README.md'), original = readFileSync(path, 'utf8');
    for (const mode of ['first-screen', 'push']) {
      const reply = spawnSync(process.execPath, ['--import', 'tsx', resolve('scripts/herdr-mod-host.ts'), cli, root, mode], { encoding: 'utf8', timeout: 40_000 });
      assert.equal(reply.status, 0, reply.stdout + reply.stderr);
      const result = JSON.parse(reply.stdout) as { ms: number; text: string; boundary: string; calls: string[][] };
      assert.ok(result.ms > 0); assert.match(result.text, /measured/u);
      assert.match(result.boundary, /no native drawing/u);
      assert.ok(result.calls.every(call => ['doctor', 'list', 'show', 'concepts', 'taste'].includes(call[0]!)));
      assert.equal(existsSync(join(root, '.git/concord/server/current.json')), true);
      assert.equal(readFileSync(path, 'utf8'), original, 'measurement restores its edited consumer source');
      if (mode === 'push') assert.match(result.text, /MOD_PUSH_/u);
    }
  } finally { stopWorkspaceServer(root); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/herdr-mod/use-case/init-from-herdr.md
test('native mod controls initialize, create, edit, check and retain a stale-save draft through the public CLI', { timeout: 90_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-herdr-workflow-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const reply = spawnSync(process.execPath, ['--import', 'tsx', resolve('scripts/herdr-mod-host.ts'), installedConcordCli(), root, 'workflow'], { encoding: 'utf8', timeout: 70_000 });
    assert.equal(reply.status, 0, reply.stdout + reply.stderr);
    const result = JSON.parse(reply.stdout) as { workflow: string; calls: string[][] };
    assert.match(result.workflow, /preserved conflict/u);
    for (const operation of ['init', 'new', 'check']) assert.ok(result.calls.some(call => call[0] === operation));
    assert.equal(existsSync(join(root, '.git/concord/server/current.json')), true);
  } finally { stopWorkspaceServer(root); rmSync(root, { recursive: true, force: true }); }
});
