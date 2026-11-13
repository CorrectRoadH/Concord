import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import * as verificationGit from '../../src/base/git/index.ts';
import { gitCommand, gitCommit } from '../support/fix-consumer.ts';
import { tmpdir } from '../support/temporary.ts';

// @use-case docs/feature/local-sdlc/use-case/verify-fix-in-one-commit.md#verify-staged
test('staged verification derives independent trees without changing index bytes, refs or worktree', () => {
  const root = mkdtempSync(join(tmpdir(), 'verification-staged-'));
  try {
    gitCommand(root, 'init', '-q'); mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'src.ts'), 'defect'); writeFileSync(join(root, 'test/removed.ts'), 'old');
    const base = gitCommit(root, 'base');
    writeFileSync(join(root, 'test/new\ncase.ts'), 'regression'); rmSync(join(root, 'test/removed.ts'));
    writeFileSync(join(root, 'src.ts'), 'fix'); gitCommand(root, 'add', '.');
    writeFileSync(join(root, 'src.ts'), 'unstaged work');
    const before = readFileSync(join(root, '.git/index'));
    const refs = gitCommand(root, 'show-ref');
    assert.equal(typeof verificationGit.captureVerificationSnapshot, 'function', 'snapshot capture must be available');
    const capture = verificationGit.captureVerificationSnapshot(root, process.env);
    const snapshots = verificationGit.deriveVerificationRed(root, capture, ['test'], process.env);
    assert.equal(capture.base, base);
    assert.equal(gitCommand(root, 'show', `${snapshots.redTree}:src.ts`), 'defect');
    assert.equal(gitCommand(root, 'show', `${snapshots.greenTree}:src.ts`), 'fix');
    assert.equal(gitCommand(root, 'show', `${snapshots.redTree}:test/new\ncase.ts`), 'regression');
    assert.equal(gitCommand(root, 'ls-tree', snapshots.redTree, '--', 'test/removed.ts'), '');
    assert.deepEqual(readFileSync(join(root, '.git/index')), before);
    assert.equal(gitCommand(root, 'show-ref'), refs);
    assert.equal(readFileSync(join(root, 'src.ts'), 'utf8'), 'unstaged work');
    const fix = gitCommit(root, 'one commit fix');
    const replay = verificationGit.deriveVerificationRed(root, verificationGit.captureVerificationSnapshot(root, process.env, fix), ['test'], process.env);
    assert.equal(replay.base, base); assert.equal(replay.redTree, snapshots.redTree);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-sdlc/use-case/verify-fix-in-one-commit.md#verify-staged
test('staged snapshots reject empty changes and changes entirely inside testRoots', () => {
  const root = mkdtempSync(join(tmpdir(), 'verification-staged-empty-'));
  try {
    gitCommand(root, 'init', '-q'); mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'source.ts'), 'base'); gitCommit(root, 'base');
    assert.throws(() => verificationGit.captureVerificationSnapshot(root, process.env), { code: 'FixUnverifiable' });
    writeFileSync(join(root, 'test/new.ts'), 'test only'); gitCommand(root, 'add', '.');
    const before = readFileSync(join(root, '.git/index'));
    const capture = verificationGit.captureVerificationSnapshot(root, process.env);
    assert.throws(() => verificationGit.deriveVerificationRed(root, capture, ['test'], process.env), { code: 'FixUnverifiable' });
    assert.deepEqual(readFileSync(join(root, '.git/index')), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
