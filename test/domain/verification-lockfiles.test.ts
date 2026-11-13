import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { executeViewAction } from '../../src/app/index.ts';
import { createFixConsumer, gitCommand, gitCommit } from '../support/fix-consumer.ts';
import { runApplication } from '../support/repository.ts';
import { verifyChanges } from '../../src/domain/tests/index.ts';
import { stagedVerificationFixture } from '../support/staged-verification.ts';

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

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
test('two-commit verification ignores later locks and checks a lock introduced by the fix', async () => {
  for (const scenario of ['later', 'fix', 'missing', 'different'] as const) {
    const fixture = await createFixConsumer();
    try {
      mkdirSync(join(fixture.root, 'packages/member'), { recursive: true });
      const path = 'packages/member/pnpm-lock.yaml';
      if (scenario !== 'later') writeFileSync(join(fixture.root, path), 'fix dependencies\n');
      const fix = fixture.fix();
      if (scenario === 'later') { writeFileSync(join(fixture.root, path), 'later dependencies\n'); gitCommit(fixture.root, 'later subproject'); }
      if (scenario === 'missing') rmSync(join(fixture.root, path));
      if (scenario === 'different') writeFileSync(join(fixture.root, path), 'different dependencies\n');
      const action = runApplication(executeViewAction(fixture.root, { action: 'issue.close', id: 'sku', fixed: true, defect: fixture.defect, fix }));
      if (scenario === 'later' || scenario === 'fix') await action;
      else await assert.rejects(action, error => {
        assert.equal((error as { code: string }).code, 'FixUnverifiable');
        assert.match((error as Error).message, new RegExp(fix));
        assert.match((error as Error).message, /packages\/member\/pnpm-lock.yaml/);
        return true;
      });
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }
});

// @use-case docs/feature/local-sdlc/use-case/verify-fix-in-one-commit.md#verify-staged
test('staged base red and green ignore main-only locks while green locks must match', async () => {
  for (const scenario of ['main-only', 'green', 'different-green'] as const) {
    const fixture = await stagedVerificationFixture();
    try {
      mkdirSync(join(fixture.root, 'packages/member'), { recursive: true });
      const path = 'packages/member/pnpm-lock.yaml';
      writeFileSync(join(fixture.root, path), 'green dependencies\n');
      if (scenario !== 'main-only') gitCommand(fixture.root, 'add', path);
      if (scenario === 'different-green') writeFileSync(join(fixture.root, path), 'unstaged dependencies\n');
      const action = runApplication(verifyChanges(fixture.root));
      if (scenario === 'different-green') await assert.rejects(action, error => {
        assert.equal((error as { code: string }).code, 'FixUnverifiable');
        assert.match((error as Error).message, /packages\/member\/pnpm-lock.yaml/);
        return true;
      });
      else {
        const result = await action;
        assert.equal(result.red[0]!.exitCode, 1); assert.equal(result.green[0]!.exitCode, 0);
      }
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }
});
