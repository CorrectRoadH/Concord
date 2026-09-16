import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { getGitDiff, getGitStatus, type GitBaselineCache } from '../dist/git-view.js';
import { deriveTestReference } from '../dist/test-reference.js';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('Git panel distinguishes staged changes, later edits, odd filenames, binary and symlinks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-git-view-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  try {
    git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    writeFileSync(join(root, 'note.md'), 'original\n'); git('add', '.'); git('commit', '-qm', 'fixture');
    writeFileSync(join(root, 'note.md'), 'staged\n'); git('add', 'note.md'); writeFileSync(join(root, 'note.md'), 'later\n');
    const odd = 'new\nname .md'; writeFileSync(join(root, odd), 'new text');
    writeFileSync(join(root, 'binary'), Buffer.from([0, 255]));
    symlinkSync('/etc/passwd', join(root, 'link'));
    const status = await Effect.runPromise(getGitStatus(root));
    assert.equal(status.entries.find(entry => entry.path === 'note.md')?.index, 'M');
    assert.equal(status.entries.find(entry => entry.path === 'note.md')?.worktree, 'M');
    assert.ok(status.entries.some(entry => entry.path === odd));
    const staged = await Effect.runPromise(getGitDiff(root, 'note.md', 'staged'));
    assert.match(staged.patch, /-original\n\+staged/);
    const unstaged = await Effect.runPromise(getGitDiff(root, 'note.md', 'unstaged'));
    assert.match(unstaged.patch, /-staged\n\+later/);
    assert.match((await Effect.runPromise(getGitDiff(root, odd, 'untracked'))).patch, /\+new text/);
    assert.equal((await Effect.runPromise(getGitDiff(root, 'binary', 'untracked'))).binary, true);
    const link = await Effect.runPromise(getGitDiff(root, 'link', 'untracked'));
    assert.equal(link.patch, ''); assert.match(link.message!, /Symbolic link/);
    await assert.rejects(Effect.runPromise(getGitDiff(root, '../etc/passwd', 'untracked')));
    git('add', 'note.md'); git('commit', '-qm', 'record edits');
    git('mv', 'note.md', 'renamed.md');
    const renamed = await Effect.runPromise(getGitStatus(root));
    assert.equal(renamed.entries.find(entry => entry.path === 'renamed.md')?.previousPath, 'note.md');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('Git test baseline derives IDs from the committed declaration path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-git-baseline-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  const cache: GitBaselineCache = {};
  try {
    git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    assert.deepEqual((await Effect.runPromise(getGitStatus(root, true))).baselineCaseIds, []);
    const source = "import test from 'node:test';\n// @feature docs/feature/example/README.md\ntest('Existing', () => {});\n";
    writeFileSync(join(root, 'old.test.ts'), source);
    writeFileSync(join(root, 'fake.ts'), 'const example = `// @feature docs/feature/example/README.md`;\n');
    git('add', '.'); git('commit', '-qm', 'baseline');
    assert.deepEqual((await Effect.runPromise(getGitStatus(root, true, cache, []))).baselineCaseIds, [], 'an empty configured testRoots does not scan repository-profile declarations');
    git('mv', 'old.test.ts', 'renamed.test.ts');
    writeFileSync(join(root, 'renamed.test.ts'), source + "// @feature docs/feature/example/README.md\ntest('New', () => {});\n");
    git('add', 'renamed.test.ts');
    const status = await Effect.runPromise(getGitStatus(root, true, cache));
    assert.deepEqual(status.baselineCaseIds, [deriveTestReference('old.test.ts', 'old.test.ts', 'Existing')]);
    const cached = cache.value;
    assert.deepEqual((await Effect.runPromise(getGitStatus(root, true, cache))).baselineCaseIds, [deriveTestReference('old.test.ts', 'old.test.ts', 'Existing')]);
    assert.equal(cache.value, cached, 'unchanged HEAD reuses its baseline');
    git('commit', '-qm', 'new baseline');
    assert.deepEqual((await Effect.runPromise(getGitStatus(root, true, cache))).baselineCaseIds, [deriveTestReference('renamed.test.ts', 'renamed.test.ts', 'Existing'), deriveTestReference('renamed.test.ts', 'renamed.test.ts', 'New')]);
    assert.notEqual(cache.value?.revision, cached?.revision);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
