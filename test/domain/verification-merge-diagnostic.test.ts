import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { firstParentPath } from '../../src/base/git/index.ts';
import { gitCommand, gitCommit } from '../support/fix-consumer.ts';
import { tmpdir } from '../support/temporary.ts';

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
// @issue docs/issues/verification-merge-diagnostic.md
test('verification merge rejection names the merge commit and interval options', () => {
  const root = mkdtempSync(join(tmpdir(), 'verification-merge-'));
  try {
    gitCommand(root, 'init', '-q');
    writeFileSync(join(root, 'initial'), 'initial'); const defect = gitCommit(root, 'initial');
    gitCommand(root, 'checkout', '-qb', 'side');
    writeFileSync(join(root, 'side'), 'side'); gitCommit(root, 'side');
    gitCommand(root, 'checkout', '-qb', 'mainline', defect);
    writeFileSync(join(root, 'mainline'), 'mainline'); gitCommit(root, 'mainline');
    gitCommand(root, 'merge', '--no-ff', '-m', 'merge', 'side');
    const fix = gitCommand(root, 'rev-parse', 'HEAD');
    assert.throws(() => firstParentPath(root, defect, fix, process.env), error => {
      assert.match((error as Error).message, new RegExp(fix));
      assert.match((error as Error).message, /--defect/); assert.match((error as Error).message, /--fix/);
      return true;
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
