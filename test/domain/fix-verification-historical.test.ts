import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { closeFixedIssue } from '../../src/domain/tests/index.js';
import { readDocumentSelector } from '../../src/domain/documents/index.js';
import { createFixConsumer, gitCommand as git, gitCommit } from '../support/fix-consumer.js';
import { LocalRepository, runApplication } from '../support/repository.js';
import { readProjectConfig, writeProjectConfig } from '../support/support.js';

async function close(root: string, defect: string, fix: string) {
  const repo = new LocalRepository(root, { optimistic: true });
  try { return await runApplication(closeFixedIssue(repo, 'sku', 'Historical fix', defect, fix)); }
  finally { repo.close(); }
}
// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
test('an explicit historical F uses runtime HEAD preparation and preserves later Issue and shared runner changes', async () => {
  const f = createFixConsumer({ runnerSource: true });
  const log = `${f.root}-historical-prepare.log`;
  try {
    const fix = f.fix();
    const path = join(f.root, 'docs/issues/sku.md');
    writeFileSync(path, readFileSync(path, 'utf8') + '\nLater investigation note.\n');
    writeFileSync(join(f.root, 'runner.ts'), '// Later shared infrastructure\n');
    writeFileSync(join(f.root, 'src/cart.ts'), 'export const quantity = -1;\n');
    const config = readProjectConfig(f.root);
    writeProjectConfig(f.root, { ...config, runner: { ...config.runner!, timeoutMs: 5001, prepare: [[process.execPath, '-e', `require('node:fs').appendFileSync(${JSON.stringify(log)}, process.cwd() + '\\n');`]] } });
    gitCommit(f.root, 'later unrelated changes');
    const head = git(f.root, 'rev-parse', 'HEAD');
    const receipt = await close(f.root, f.defect, fix);
    assert.equal(receipt.verification.fix, fix);
    assert.notEqual(head, fix);
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), head);
    assert.throws(() => readFileSync(path), /ENOENT/u);
    assert.equal(readFileSync(join(f.root, 'runner.ts'), 'utf8'), '// Later shared infrastructure\n');
    assert.equal(readFileSync(join(f.root, 'src/cart.ts'), 'utf8'), 'export const quantity = -1;\n');
    const roots = readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(roots.length, 2);
    assert.ok(roots.every(root => root !== f.root));
    assert.equal(git(f.root, 'worktree', 'list', '--porcelain').split('\n').filter(line => line.startsWith('worktree ')).length, 1);
  } finally { rmSync(f.root, { recursive: true, force: true }); rmSync(log, { force: true }); }
});

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#结果
test('explicit fix rejects unavailable, non-first-parent and not-after-defect commits without changing the Issue', async t => {
  for (const name of ['missing', 'not-after-defect', 'side-branch'] as const) await t.test(name, async () => {
    const f = createFixConsumer();
    try {
      const fix = f.fix();
      let selected = name === 'missing' ? '0'.repeat(40) : f.defect;
      if (name === 'side-branch') {
        const branch = git(f.root, 'branch', '--show-current');
        git(f.root, 'switch', '-qc', 'side');
        writeFileSync(join(f.root, 'side.txt'), 'Side branch\n');
        selected = gitCommit(f.root, 'side branch only');
        git(f.root, 'switch', '-q', branch);
        assert.equal(git(f.root, 'rev-parse', 'HEAD'), fix);
      }
      const path = join(f.root, 'docs/issues/sku.md');
      const before = readFileSync(path, 'utf8');
      await assert.rejects(close(f.root, f.defect, selected), cause => (cause as { code: string }).code === 'FixUnverifiable');
      assert.equal(readFileSync(path, 'utf8'), before);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
test('a merge after the selected F does not widen the frozen D..F interval', async () => {
  const f = createFixConsumer();
  try {
    const fix = f.fix();
    const branch = git(f.root, 'branch', '--show-current');
    git(f.root, 'switch', '-qc', 'side');
    writeFileSync(join(f.root, 'side.txt'), 'Side branch\n'); gitCommit(f.root, 'side');
    git(f.root, 'switch', '-q', branch);
    writeFileSync(join(f.root, 'main.txt'), 'Main branch\n'); gitCommit(f.root, 'main');
    git(f.root, 'merge', '--no-ff', '-qm', 'later merge', 'side');
    const receipt = await close(f.root, f.defect, fix);
    assert.equal(receipt.verification.fix, fix);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
