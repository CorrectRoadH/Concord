// 跨进程保证：外部程序——真实mod宿主经CLI协议读取工作区并复用共享服务，退出时恢复安装源文件。
import { stopWorkspaceServer } from '../support/stop-workspace-server.ts';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { installedConcordCli } from '../support/support.ts';
import { tmpdir } from '../support/temporary.ts';

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
      const reply = spawnSync(process.execPath, [resolve('scripts/herdr-mod-host.ts'), cli, root, mode], { encoding: 'utf8', timeout: 40_000 });
      assert.equal(reply.status, 0, reply.stdout + reply.stderr);
      const result = JSON.parse(reply.stdout) as { ms: number; text: string; boundary: string; calls: string[][] };
      assert.ok(result.ms > 0); assert.match(result.text, /measured/u);
      assert.match(result.boundary, /no native drawing/u);
      assert.ok(result.calls.every(call => ['--version', 'doctor', 'list', 'show', 'concepts', 'taste', 'action', 'workspace', 'rev-parse'].includes(call[0]!)));
      assert.equal(existsSync(join(root, '.git/concord/server/current.json')), true);
      assert.equal(readFileSync(path, 'utf8'), original, 'measurement restores its edited consumer source');
      if (mode === 'push') assert.match(result.text, /MOD_PUSH_/u);
    }
  } finally { stopWorkspaceServer(root); rmSync(root, { recursive: true, force: true }); }
});
