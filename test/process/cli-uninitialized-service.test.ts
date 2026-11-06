// 跨进程保证：服务与 IPC——未初始化Git仓库的真实server start/status/stop仍提供初始化页并回收服务
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { tmpdir } from '../support/temporary.ts';
import { sourceCli } from '../support/source-consumer.ts';

const cli = sourceCli();
const requiredCommands = [
  ['check'], ['list'], ['show', 'missing'], ['trace', 'gaps'], ['test', 'list'], ['code', 'list'], ['code', 'analyze'],
  ['new', 'feature', 'example'], ['use-case', 'steps', 'missing'], ['roadmap', 'start', 'missing'],
  ['issue', 'search', 'bug'], ['memory', 'search', 'lesson'], ['taste'], ['concepts', 'index'], ['writing', 'index'],
  ['docs', 'check'], ['feedback', 'connection', 'list'], ['skills', 'install'], ['config', 'show'],
  ['cache', 'status'], ['cache', 'clear'], ['cache', 'rebuild'], ['recover'], ['lsp'], ['review'],
  ['action', '--input', '-'], ['workspace', 'show'], ['workspace', 'projection'], ['git', 'status'],
  ['view', 'export', '--base', 'HEAD', '--out', 'preview'],
];

function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (path: string) => {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      const next = join(path, entry.name);
      files[next] = entry.isDirectory() ? 'directory' : readFileSync(join(root, next)).toString('base64');
      if (entry.isDirectory()) visit(next);
    }
  };
  visit(''); return files;
}

function consumer(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'concord-uninitialized-cli-'));
  try { execFileSync('git', ['init', '-q', root]); run(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

function invoke(root: string, args: readonly string[], json = true) {
  const arguments_ = args.includes('--skill') ? args : ['--root', root, ...(json ? ['--json'] : []), ...args];
  return spawnSync(process.execPath, [cli, ...arguments_], {
    cwd: root, encoding: 'utf8', input: '{"action":"init"}', timeout: 30_000,
    env: { ...process.env, HERDR_APP_HOME: join(root, '.herdr') },
  });
}

// @use-case docs/feature/project-onboarding/use-case/open-uninitialized-repo.md#cli
test('server lifecycle commands remain available to host and reclaim the initialization page', () => consumer(root => {
  try {
    const started = invoke(root, ['server', 'start']);
    assert.equal(started.status, 0, started.stderr);
    assert.equal(JSON.parse(started.stdout).operation, 'server-start');
    const status = invoke(root, ['server', 'status']);
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).operation, 'server-status');
    assert.equal(existsSync(join(root, 'docs/taste.md')), false);
  } finally {
    const stopped = invoke(root, ['server', 'stop']);
    assert.equal(stopped.status, 0, stopped.stderr);
    assert.equal(JSON.parse(stopped.stdout).operation, 'server-stop');
  }
}));

