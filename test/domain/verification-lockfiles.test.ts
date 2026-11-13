import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { executeViewAction } from '../../src/app/index.ts';
import { createFixConsumer, gitCommit } from '../support/fix-consumer.ts';
import { runApplication } from '../support/repository.ts';

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
test('verification rejects historical dependency locks that differ from installed worktree locks', async () => {
  const fixture = await createFixConsumer();
  try {
    mkdirSync(join(fixture.root, 'packages/member'), { recursive: true });
    const path = 'packages/member/pnpm-lock.yaml';
    writeFileSync(join(fixture.root, path), 'historical dependencies\n');
    const defect = gitCommit(fixture.root, 'historical lock');
    const fix = fixture.fix();
    writeFileSync(join(fixture.root, path), 'current dependencies\n');
    await assert.rejects(runApplication(executeViewAction(fixture.root, { action: 'issue.close', id: 'sku', fixed: true, defect, fix })), error => {
      assert.equal((error as { code: string }).code, 'FixUnverifiable');
      assert.match((error as Error).message, /packages\/member\/pnpm-lock.yaml/);
      assert.match((error as Error).message, new RegExp(defect));
      return true;
    });
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});
