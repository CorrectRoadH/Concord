import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { closeFixedIssue } from '../../src/domain/tests/index.ts';
import { readDocumentSelector } from '../../src/domain/documents/index.ts';
import { createFixConsumer, gitCommand } from '../support/fix-consumer.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';

const verify = (root: string) => {
  const repo = new LocalRepository(root, { optimistic: true });
  return runApplication(closeFixedIssue(repo, 'sku', 'Accumulate quantity')).finally(() => repo.close());
};
// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
test('fix verification runs committed inputs despite dirty sources, tests, runner configuration and unrelated staged files', async () => {
  const f = createFixConsumer();
  try {
    const fix = f.fix();
    const changes = [
      ['src/cart.ts', 'export const quantity = -1;\n'],
      ['test/cart.test.ts', '// Pending replacement test\n'],
      ['concord.config.ts', 'export default {};\n'],
      ['untracked.txt', 'Other work\n'],
    ] as const;
    for (const [path, source] of changes) writeFileSync(join(f.root, path), source);
    gitCommand(f.root, 'add', 'src/cart.ts');
    const staged = gitCommand(f.root, 'diff', '--cached');
    const receipt = await verify(f.root);
    assert.equal(receipt.verification.fix, fix);
    for (const [path, source] of changes) assert.equal(readFileSync(join(f.root, path), 'utf8'), source, path);
    assert.equal(gitCommand(f.root, 'diff', '--cached'), staged);
    assert.equal(gitCommand(f.root, 'worktree', 'list', '--porcelain').split('\n').filter(line => line.startsWith('worktree ')).length, 1);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
test('a parallel commit during verification preserves the initially captured fix commit', async () => {
  const f = createFixConsumer({ runner: 'move-head' });
  try {
    const fix = f.fix();
    const receipt = await verify(f.root);
    assert.notEqual(gitCommand(f.root, 'rev-parse', 'HEAD'), fix);
    assert.equal(gitCommand(f.root, 'rev-parse', 'HEAD^'), fix);
    assert.equal(receipt.verification.fix, fix);
    assert.equal(readFileSync(join(f.root, 'parallel.txt'), 'utf8'), 'Independent commit\n');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
test('runner configuration changed during isolated verification is preserved and does not invalidate the frozen run', async () => {
  const f = createFixConsumer({ runner: 'edit-config' });
  try {
    const fix = f.fix();
    const receipt = await verify(f.root);
    assert.equal(receipt.verification.fix, fix);
    assert.equal(readFileSync(join(f.root, 'concord.config.ts'), 'utf8'), 'export default {};\n');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#结果
test('an Issue edited during verification is preserved and closing returns FileChangedSinceRead', async () => {
  const f = createFixConsumer({ runner: 'edit-issue' });
  try {
    f.fix();
    const path = join(f.root, 'docs/issues/sku.md');
    const before = readFileSync(path, 'utf8');
    await assert.rejects(verify(f.root), cause => {
      assert.equal((cause as { code: string }).code, 'FileChangedSinceRead');
      return true;
    });
    assert.equal(readFileSync(path, 'utf8'), before + '\nConcurrent Issue note.\n');
    assert.equal(gitCommand(f.root, 'worktree', 'list', '--porcelain').split('\n').filter(line => line.startsWith('worktree ')).length, 1);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
