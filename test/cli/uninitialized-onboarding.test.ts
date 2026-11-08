import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { tmpdir } from '../support/temporary.ts';
import { sourceCli } from '../support/source-consumer.ts';
import { runCli } from '../support/cli.ts';

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

async function consumer(run: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'concord-uninitialized-cli-'));
  try { execFileSync('git', ['init', '-q', root]); await run(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

async function invoke(root: string, args: readonly string[], json = true) {
  const arguments_ = args.includes('--skill') ? args : ['--root', root, ...(json ? ['--json'] : []), ...args];
  return runCli({argv:arguments_,
    cwd: root, stdin: '{"action":"init"}', signal:AbortSignal.timeout(30_000),
    env: { ...process.env, HERDR_APP_HOME: join(root, '.herdr') },
  });
}

// @use-case docs/feature/project-onboarding/use-case/open-uninitialized-repo.md#cli
test('every project command rejects an empty Git worktree before any repository or private-state write', async () => consumer(async root => {
  const before = snapshot(root);
  for (const args of requiredCommands) {
    const result = (await invoke(root, args));
    assert.equal(result.exitCode, 1, JSON.stringify({ args, ...result }));
    assert.equal(result.stdout, '', args.join(' '));
    const error = JSON.parse(result.stderr);
    assert.equal(error.error, 'ProjectNotInitialized', `${args.join(' ')}: ${result.stderr}`);
    assert.deepEqual(error.details, { root });
    assert.deepEqual(snapshot(root), before, `${args.join(' ')} changed repository/private state`);
  }
}));

// @use-case docs/feature/project-onboarding/use-case/open-uninitialized-repo.md#cli
test('uninitialized human errors recommend init and the start command', async () => consumer(async root => {
  mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src/main.ts'), 'export const answer = 42;\n');
  const before = snapshot(root);
  const result = (await invoke(root, ['check'], false));
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'ok: false\nerror: ProjectNotInitialized\nmessage: This repository has not been initialized for Concord.\n\nInitialize: concord init\nWriting guide after init: concord --skill start\n');
  const error = (await invoke(root, ['--dry-run', 'new', 'feature', 'example']));
  assert.deepEqual(JSON.parse(error.stderr).details, { root });
  assert.deepEqual(snapshot(root), before);
}));

// @use-case docs/feature/project-onboarding/use-case/open-uninitialized-repo.md#cli
test('help version skills templates and doctor remain usable without initialization', async () => consumer(async root => {
  const before = snapshot(root);
  for (const args of [['--help'], ['check', '--help'], ['--version'], ['--skill'], ['--skill', 'docs-from-scratch'], ['template', 'list'], ['template', 'show', 'feature']]) {
    const result = (await invoke(root, args));
    assert.equal(result.exitCode, 0, `${args.join(' ')}: ${result.stderr}`);
    assert.notEqual(result.stdout, '');
  }
  const diagnosed = (await invoke(root, ['doctor']));
  assert.equal(diagnosed.exitCode, 0, diagnosed.stderr);
  const doctor = JSON.parse(diagnosed.stdout);
  assert.equal(doctor.findings.some((finding: { code: string }) => finding.code === 'ProjectNotInitialized'), true);
  assert.equal(doctor.nextSteps[0], 'concord init');
  assert.deepEqual(snapshot(root), before);
}));

// @use-case docs/feature/project-onboarding/use-case/open-uninitialized-repo.md#cli
test('Herdr install and uninstall dry-runs stay independent of initialization', async () => consumer(async root => {
  mkdirSync(join(root, '.herdr'));
  const before = snapshot(root);
  for (const operation of ['install', 'uninstall']) {
    const result = (await invoke(root, ['--dry-run', 'herdr', operation]));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).operation, `herdr-${operation}`);
  }
  assert.deepEqual(snapshot(root), before);
}));

// @use-case docs/feature/project-onboarding/use-case/open-uninitialized-repo.md#cli
test('only taste-file existence determines initialization and non-Git directories retain their error', async () => consumer(async root => {
  mkdirSync(join(root, 'docs')); writeFileSync(join(root, 'concord.config.ts'), 'export default {};\n');
  const rejected = (await invoke(root, ['--dry-run', 'list']));
  assert.equal(JSON.parse(rejected.stderr).error, 'ProjectNotInitialized');
  writeFileSync(join(root, 'docs/taste.md'), '');
  const accepted = (await invoke(root, ['--dry-run', 'list']));
  assert.equal(accepted.exitCode, 0, accepted.stderr);
  assert.equal(existsSync(join(root, 'docs/taste.md')), true);
  const outside = mkdtempSync(join(tmpdir(), 'concord-non-git-'));
  try {
    const result = (await invoke(outside, ['check']));
    assert.equal(result.exitCode, 1);
    assert.equal(JSON.parse(result.stderr).error, 'GitFailed');
    const fromCwd = await runCli({argv:['--json','check'],cwd:outside,env:process.env,signal:AbortSignal.timeout(30_000)});
    assert.equal(fromCwd.exitCode, 1);
    assert.equal(JSON.parse(fromCwd.stderr).error, 'ProjectNotFound');
    assert.deepEqual(readdirSync(outside), []);
  } finally { rmSync(outside, { recursive: true, force: true }); }
}));

// @use-case docs/feature/project-onboarding/use-case/open-uninitialized-repo.md#cli
test('init remains available and immediately permits project commands', async () => consumer(async root => {
  const initialized = (await invoke(root, ['init']));
  assert.equal(initialized.exitCode, 0, initialized.stderr);
  assert.equal(Object.hasOwn(JSON.parse(initialized.stdout), 'guide'), false);
  const listed = (await invoke(root, ['--dry-run', 'list']));
  assert.equal(listed.exitCode, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout).operation, 'list');
}));
