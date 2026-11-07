import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { decodeViewAction, executeViewAction } from '../../src/app/index.ts';
import { createFixConsumer } from '../support/fix-consumer.ts';
import { runApplication } from '../support/repository.ts';

// @use-case docs/feature/web-workbench/use-case/handle-lifecycle-in-workbench.md#close
test('Issue fixed actions decode CLI inputs and reject caller-provided verification', () => {
  const action = { action: 'issue.close', id: 'sku', fixed: true, defect: 'HEAD~1', fix: 'HEAD', reason: 'Fix' };
  assert.deepEqual(decodeViewAction(action), action);
  assert.throws(() => decodeViewAction({ ...action, verification: { verified: true } }), { code: 'InvalidData' });
});

// @use-case docs/feature/web-workbench/use-case/handle-lifecycle-in-workbench.md#close
test('Issue actions preserve reason closure and reject invalid fixed options before mutation', async () => {
  const fixture = (await createFixConsumer());
  const issue = join(fixture.root, 'docs/issues/sku.md');
  try {
    for (const options of [{ fixed: true, dryRun: true }, { defect: 'HEAD~1' }, { fix: 'HEAD' }]) {
      await assert.rejects(runApplication(executeViewAction(fixture.root, { action: 'issue.close', id: 'sku', ...options })), { code: 'InvalidOption' });
      assert.equal(existsSync(issue), true);
    }
    await runApplication(executeViewAction(fixture.root, { action: 'issue.close', id: 'sku', reason: 'Handled without fixed verification' }));
    assert.equal(existsSync(issue), false);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/handle-lifecycle-in-workbench.md#close
test('fixed action verifies real frozen red and green commands before deleting the Issue', async () => {
  const fixture = (await createFixConsumer());
  try {
    const fix = fixture.fix();
    const result = await runApplication(executeViewAction(fixture.root, { action: 'issue.close', id: 'sku', fixed: true, defect: fixture.defect, fix, reason: 'Accumulate quantity' })) as {
      verification: { defect: string; fix: string };
      red: { exitCode: number }[];
      green: { exitCode: number }[];
    };
    assert.deepEqual([result.verification.defect, result.verification.fix, result.red[0]!.exitCode, result.green[0]!.exitCode], [fixture.defect, fix, 1, 0]);
    assert.equal(existsSync(join(fixture.root, 'docs/issues/sku.md')), false);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/handle-lifecycle-in-workbench.md#close
test('fixed action leaves the Issue untouched when the real defect runner is green', async () => {
  const fixture = (await createFixConsumer({ greenAtDefect: true }));
  const path = join(fixture.root, 'docs/issues/sku.md');
  try {
    writeFileSync(join(fixture.root, 'unrelated.txt'), 'Later commit without behavior changes\n');
    fixture.fix();
    const before = readFileSync(path, 'utf8');
    await assert.rejects(runApplication(executeViewAction(fixture.root, { action: 'issue.close', id: 'sku', fixed: true, defect: fixture.defect })), { code: 'FixUnverifiable' });
    assert.equal(readFileSync(path, 'utf8'), before);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});
