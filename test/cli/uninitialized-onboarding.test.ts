import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { tmpdir } from '../support/temporary.ts';
import { sourceRoot, sourceCli } from '../support/source-consumer.ts';

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
test('every project command rejects an empty Git worktree before any repository or private-state write', () => consumer(root => {
  const before = snapshot(root);
  for (const args of requiredCommands) {
    const result = invoke(root, args);
    assert.equal(result.status, 1, JSON.stringify({ args, ...result }));
    assert.equal(result.stdout, '', args.join(' '));
    const error = JSON.parse(result.stderr);
    assert.equal(error.error, 'ProjectNotInitialized', `${args.join(' ')}: ${result.stderr}`);
    assert.deepEqual(error.details, { root, guide: 'docs-from-scratch' });
    assert.deepEqual(snapshot(root), before, `${args.join(' ')} changed repository/private state`);
  }
}));

// @use-case docs/feature/project-onboarding/use-case/open-uninitialized-repo.md#cli
test('uninitialized human errors recommend init and use the same Git-file guide selection as init', () => consumer(root => {
  mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src/main.ts'), 'export const answer = 42;\n');
  const before = snapshot(root);
  const result = invoke(root, ['check'], false);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'ok: false\nerror: ProjectNotInitialized\nmessage: This repository has not been initialized for Concord.\n\nInitialize: concord init\nWriting guide after init: concord --skill docs-from-code\n');
  const error = invoke(root, ['--dry-run', 'new', 'feature', 'example']);
  assert.deepEqual(JSON.parse(error.stderr).details, { root, guide: 'docs-from-code' });
  assert.deepEqual(snapshot(root), before);
}));

// @use-case docs/feature/project-onboarding/use-case/open-uninitialized-repo.md#cli
test('help version skills templates and doctor remain usable without initialization', () => consumer(root => {
  const before = snapshot(root);
  for (const args of [['--help'], ['check', '--help'], ['--version'], ['--skill'], ['--skill', 'docs-from-scratch'], ['template', 'list'], ['template', 'show', 'feature']]) {
    const result = invoke(root, args);
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    assert.notEqual(result.stdout, '');
  }
  const diagnosed = invoke(root, ['doctor']);
  assert.equal(diagnosed.status, 0, diagnosed.stderr);
  const doctor = JSON.parse(diagnosed.stdout);
  assert.equal(doctor.findings.some((finding: { code: string }) => finding.code === 'ProjectNotInitialized'), true);
  assert.equal(doctor.nextSteps[0], 'concord init');
  assert.deepEqual(snapshot(root), before);
}));

// @use-case docs/feature/project-onboarding/use-case/open-uninitialized-repo.md#cli
test('Herdr install and uninstall dry-runs stay independent of initialization', () => consumer(root => {
  mkdirSync(join(root, '.herdr'));
  const before = snapshot(root);
  for (const operation of ['install', 'uninstall']) {
    const result = invoke(root, ['--dry-run', 'herdr', operation]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).operation, `herdr-${operation}`);
  }
  assert.deepEqual(snapshot(root), before);
}));

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

// @use-case docs/feature/project-onboarding/use-case/open-uninitialized-repo.md#cli
test('only taste-file existence determines initialization and non-Git directories retain their error', () => consumer(root => {
  mkdirSync(join(root, 'docs')); writeFileSync(join(root, 'concord.config.ts'), 'export default {};\n');
  const rejected = invoke(root, ['--dry-run', 'list']);
  assert.equal(JSON.parse(rejected.stderr).error, 'ProjectNotInitialized');
  writeFileSync(join(root, 'docs/taste.md'), '');
  const accepted = invoke(root, ['--dry-run', 'list']);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(existsSync(join(root, 'docs/taste.md')), true);
  const outside = mkdtempSync(join(tmpdir(), 'concord-non-git-'));
  try {
    const result = invoke(outside, ['check']);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).error, 'GitFailed');
    const fromCwd = spawnSync(process.execPath, [cli, '--json', 'check'], { cwd: outside, encoding: 'utf8', timeout: 30_000 });
    assert.equal(fromCwd.status, 1);
    assert.equal(JSON.parse(fromCwd.stderr).error, 'ProjectNotFound');
    assert.deepEqual(readdirSync(outside), []);
  } finally { rmSync(outside, { recursive: true, force: true }); }
}));

// @use-case docs/feature/project-onboarding/use-case/open-uninitialized-repo.md#cli
test('init remains available and immediately permits project commands', () => consumer(root => {
  const initialized = invoke(root, ['init']);
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.equal(JSON.parse(initialized.stdout).guide, 'docs-from-scratch');
  const listed = invoke(root, ['--dry-run', 'list']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout).operation, 'list');
}));
