import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Effect } from 'effect';
import { FrozenBrowserRepository } from '../support/browser-shared-fixture.ts';
import { tmpdir } from '../support/temporary.ts';

// @feature docs/engineering/testing/architecture.md#浏览器与诊断
test('frozen browser worktree recovers changed, deleted and added files without following symlinks or replacing Git state', () => Effect.runPromise(Effect.tryPromise(async () => {
  const fixture = (await FrozenBrowserRepository.open());
  const outside = mkdtempSync(join(tmpdir(), 'concord-browser-outside-'));
  try {
    const original = readFileSync(join(fixture.root, 'docs/taste.md'));
    const sentinel = join(outside, 'sentinel');
    writeFileSync(sentinel, 'outside remains untouched');
    writeFileSync(join(outside, 'exclude'), 'outside exclusion remains untouched');
    writeFileSync(join(fixture.root, 'docs/taste.md'), 'changed');
    rmSync(join(fixture.root, 'docs/architecture.md'));
    writeFileSync(join(fixture.root, 'extra.md'), 'added');
    writeFileSync(join(fixture.root, '.git', 'fixture-sentinel'), 'live private state');
    rmSync(join(fixture.root, 'memory'), { recursive: true, force: true });
    symlinkSync(outside, join(fixture.root, 'memory'));
    symlinkSync(outside, join(fixture.root, 'outside'));
    rmSync(join(fixture.root, '.git/info'), { recursive: true, force: true });
    symlinkSync(outside, join(fixture.root, '.git/info'));
    fixture.restore();
    assert.deepEqual(readFileSync(join(fixture.root, 'docs/taste.md')), original);
    assert.equal(readFileSync(sentinel, 'utf8'), 'outside remains untouched');
    assert.equal(readFileSync(join(outside, 'exclude'), 'utf8'), 'outside exclusion remains untouched');
    assert.equal(readFileSync(join(fixture.root, '.git/fixture-sentinel'), 'utf8'), 'live private state');
    assert.equal(execFileSync('git', ['-C', fixture.root, 'status', '--porcelain'], { encoding: 'utf8' }), '');
    assert.equal(execFileSync('git', ['-C', fixture.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), fixture.commit);
  } finally { fixture.close(); rmSync(outside, { recursive: true, force: true }); }
})));

// @feature docs/engineering/testing/architecture.md#浏览器与诊断
test('frozen restoration includes ignored files, index flags and configuration while leaving unchanged files and index intact', () => Effect.runPromise(Effect.tryPromise(async () => {
  const fixture = (await FrozenBrowserRepository.open());
  const git = (...args: string[]) => execFileSync('git', ['-C', fixture.root, ...args]);
  try {
    const unchanged = join(fixture.root, 'docs/taste.md');
    const original = readFileSync(unchanged);
    const config = join(fixture.root, 'concord.config.ts');
    const configBytes = readFileSync(config);
    const gitConfig = readFileSync(join(fixture.root, '.git/config'));
    const excludes = readFileSync(join(fixture.root, '.git/info/exclude'));
    const index = join(fixture.root, '.git/index');
    const indexBefore = statSync(index, { bigint: true });
    const fileBefore = statSync(unchanged, { bigint: true });
    fixture.restore();
    assert.equal(statSync(index, { bigint: true }).ino, indexBefore.ino);
    assert.equal(statSync(index, { bigint: true }).mtimeNs, indexBefore.mtimeNs);
    assert.equal(statSync(unchanged, { bigint: true }).ino, fileBefore.ino);
    assert.equal(statSync(unchanged, { bigint: true }).mtimeNs, fileBefore.mtimeNs);
    writeFileSync(join(fixture.root, '.git/info/exclude'), 'ignored-output/\n');
    mkdirSync(join(fixture.root, 'ignored-output'));
    writeFileSync(join(fixture.root, 'ignored-output/result'), 'ignored payload');
    writeFileSync(join(fixture.root, '.hidden-extra'), 'hidden payload');
    mkdirSync(join(fixture.root, 'extra-empty'));
    writeFileSync(config, 'broken config');
    git('add', 'concord.config.ts');
    git('update-index', '--assume-unchanged', 'docs/taste.md');
    git('config', 'fixture.extra', 'changed');
    chmodSync(unchanged, 0o755);
    fixture.restore();
    assert.equal(existsSync(join(fixture.root, 'ignored-output')), false);
    assert.equal(existsSync(join(fixture.root, '.hidden-extra')), false);
    assert.equal(existsSync(join(fixture.root, 'extra-empty')), false);
    assert.deepEqual(readFileSync(config), configBytes);
    assert.deepEqual(readFileSync(join(fixture.root, '.git/config')), gitConfig);
    assert.deepEqual(readFileSync(join(fixture.root, '.git/info/exclude')), excludes);
    assert.deepEqual(readFileSync(unchanged), original);
    assert.equal(statSync(unchanged, { bigint: true }).ino, fileBefore.ino);
    assert.equal(statSync(unchanged).mode & 0o777, Number(fileBefore.mode) & 0o777);
    assert.match(git('ls-files', '-v', 'docs/taste.md').toString(), /^H /u);
    assert.equal(git('diff', '--cached', '--name-only').toString(), '');
  } finally { fixture.close(); }
})));

for (const change of ['commit', 'ref', 'detached'] as const) {
  // @feature docs/engineering/testing/architecture.md#浏览器与诊断
  test(`frozen ${change} drift fails before restoration and retains the original worktree and index`, () => Effect.runPromise(Effect.tryPromise(async () => {
    const fixture = (await FrozenBrowserRepository.open());
    const git = (...args: string[]) => execFileSync('git', ['-C', fixture.root, ...args]);
    try {
      const path = join(fixture.root, 'docs/taste.md');
      writeFileSync(path, 'drift evidence');
      git('add', 'docs/taste.md');
      if (change === 'commit') git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'drift');
      if (change === 'ref') git('update-ref', 'refs/heads/unexpected', fixture.commit);
      if (change === 'detached') writeFileSync(join(fixture.root, '.git/HEAD'), `${fixture.commit}\n`);
      const index = readFileSync(join(fixture.root, '.git/index'));
      assert.throws(() => fixture.restore(), /frozen HEAD or refs/u);
      fixture.close();
      assert.equal(existsSync(fixture.root), true);
      assert.equal(readFileSync(path, 'utf8'), 'drift evidence');
      assert.deepEqual(readFileSync(join(fixture.root, '.git/index')), index);
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  })));
}
