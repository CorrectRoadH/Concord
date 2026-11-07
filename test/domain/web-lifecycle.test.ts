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
