// 跨进程保证：外部程序——真实 mod 经 CLI 自动保存，并重新载入后台文件更新。
import { stopWorkspaceServer } from '../support/stop-workspace-server.ts';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { installedConcordCli } from '../support/support.ts';
import { tmpdir } from '../support/temporary.ts';

// @use-case docs/feature/herdr-mod/use-case/init-from-herdr.md
test('native mod initializes, edits in place, autosaves and reloads external changes through the public CLI', { timeout: 90_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-herdr-workflow-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const reply = spawnSync(process.execPath, [resolve('test/support/herdr-mod-host.ts'), installedConcordCli(), root, 'workflow'], { encoding: 'utf8', timeout: 70_000 });
    assert.equal(reply.status, 0, reply.stdout + reply.stderr);
    const result = JSON.parse(reply.stdout) as { workflow: string; calls: string[][] };
    assert.match(result.workflow, /autosaved, checked, reloaded external update/u);
    for (const operation of ['init', 'check']) assert.ok(result.calls.some(call => call[0] === operation));
    assert.equal(result.calls.some(call => call[0] === 'new'), false);
    assert.equal(existsSync(join(root, '.git/concord/server/current.json')), true);
  } finally { stopWorkspaceServer(root); rmSync(root, { recursive: true, force: true }); }
});
