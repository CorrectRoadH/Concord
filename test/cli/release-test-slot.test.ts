import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, lstatSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { beginRun } from '../../src/base/publication/index.ts';
import { runCli } from '../support/cli.ts';
import { fixture } from '../support/publication-ownership-fixture.ts';

const invoke = (root: string, args: string[], json = true) => runCli({ argv: ['--root', root, ...(json ? ['--json'] : []), ...args], cwd: process.cwd(), env: process.env, stdin: '', signal: AbortSignal.timeout(15000) });
function deadPid(): number {
  const child = spawnSync(process.execPath, ['--eval', 'process.exit(0)']);
  assert.equal(child.status, 0); return child.pid;
}
function ownerFixture(root: string, pid: number, host = hostname()) {
  const run = beginRun(root, process.env);
  const file = join(run.lease.path, `${run.lease.owner.token}.json`);
  writeFileSync(file, JSON.stringify({ ...run.lease.owner, pid, host }));
  return { run, file, state: join(root, '.git/concord', `run-${run.lease.owner.token}.json`) };
}

// @use-case docs/feature/local-sdlc/use-case/recover-local-state.md#release-test-slot
test('recover reports dead slot identity and explicitly releases its state and registered worktree', async t => {
  const root = await fixture(t);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'baseline'], { stdio: 'pipe' });
  const { run, file, state } = ownerFixture(root, deadPid());
  const scratch = mkdtempSync(join(tmpdir(), 'concord-verify-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const worktree = join(scratch, 'worktree');
  execFileSync('git', ['-C', root, 'worktree', 'add', '--detach', worktree, 'HEAD'], { stdio: 'pipe' });
  const identity = lstatSync(scratch);
  writeFileSync(state, JSON.stringify({ ...JSON.parse(readFileSync(state, 'utf8')), worktrees: [{ path: worktree, dev: identity.dev, ino: identity.ino }] }));
  const blocked = await invoke(root, ['recover']);
  assert.equal(blocked.exitCode, 1, blocked.stdout + blocked.stderr);
  const report = JSON.parse(blocked.stdout);
  assert.equal(report.status, 'blocked');
  assert.equal(report.testSlot.token, run.lease.owner.token);
  assert.equal(report.testSlot.pid, JSON.parse(readFileSync(file, 'utf8')).pid);
  assert.equal(report.testSlot.ownerAlive, false);
  assert.equal(report.testSlot.host, hostname());
  assert.ok(Date.parse(report.testSlot.startedAt));
  assert.match(report.testSlot.release, new RegExp(run.lease.owner.token));
  const release = await invoke(root, ['recover', '--release-test-slot', run.lease.owner.token]);
  assert.equal(release.exitCode, 0, release.stdout + release.stderr);
  assert.equal(JSON.parse(release.stdout).testSlot.status, 'released');
  assert.equal(existsSync(file), false); assert.equal(existsSync(state), false);
  assert.equal(existsSync(scratch), false);
  assert.ok(!execFileSync('git', ['-C', root, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).includes(worktree));
  const clean = await invoke(root, ['recover']);
  assert.equal(clean.exitCode, 0, clean.stdout + clean.stderr);
  assert.equal(JSON.parse(clean.stdout).testSlot.status, 'absent');
});

// @use-case docs/feature/local-sdlc/use-case/recover-local-state.md#release-test-slot
test('release refuses active owner, wrong token, foreign host and absent slot without deleting state', async t => {
  for (const scenario of ['active', 'token', 'host', 'absent'] as const) {
    const root = await fixture(t);
    const owned = scenario === 'absent' ? undefined : ownerFixture(root, scenario === 'active' ? process.pid : deadPid(), scenario === 'host' ? 'other-host' : hostname());
    const token = scenario === 'token' || scenario === 'absent' ? '00000000-0000-0000-0000-000000000000' : owned!.run.lease.owner.token;
    const before = owned && readFileSync(owned.file);
    const result = await invoke(root, ['recover', '--release-test-slot', token]);
    assert.equal(result.exitCode, 1);
    const error = JSON.parse(result.stderr);
    assert.equal(error.error, scenario === 'active' ? 'TestSlotActive' : 'TestSlotMismatch');
    if (owned) { assert.deepEqual(readFileSync(owned.file), before); assert.ok(existsSync(owned.state)); assert.match(error.message, new RegExp(owned.run.lease.owner.token)); }
    if (scenario === 'host') assert.match(error.message, /other-host/);
  }
});

// @use-case docs/feature/local-sdlc/use-case/recover-local-state.md#release-test-slot
test('RepositoryBusy text identifies the occupying slot and release command', async t => {
  const root = await fixture(t);
  const { run } = ownerFixture(root, deadPid());
  assert.throws(() => beginRun(root, process.env), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, new RegExp(run.lease.owner.token));
    assert.match(error.message, /pid=\d+/); assert.match(error.message, /ownerAlive=false/);
    assert.match(error.message, /concord recover --release-test-slot/); return true;
  });
  const text = await invoke(root, ['recover'], false);
  assert.equal(text.exitCode, 1); assert.match(text.stdout, new RegExp(run.lease.owner.token));
  assert.match(text.stdout, /ownerAlive: false/);
});
