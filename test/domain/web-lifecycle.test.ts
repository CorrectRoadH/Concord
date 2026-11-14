import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { decodeViewAction, executeViewAction } from '../../src/app/index.ts';
import { createFixConsumer } from '../support/fix-consumer.ts';
import { runApplication } from '../support/repository.ts';

// @use-case docs/feature/web-workbench/use-case/handle-lifecycle-in-workbench.md#close
test('Issue close actions decode reason inputs and reject caller-provided verification fields', () => {
  const action = { action: 'issue.close', id: 'sku', reason: 'Fix' };
  assert.deepEqual(decodeViewAction(action), action);
  assert.deepEqual(decodeViewAction({ ...action, dryRun: true }), { ...action, dryRun: true });
  for (const fields of [{ fixed: true }, { defect: 'HEAD~1' }, { fix: 'HEAD' }, { verification: { verified: true } }]) {
    assert.throws(() => decodeViewAction({ ...action, ...fields }), { code: 'InvalidData' });
  }
});

// @use-case docs/feature/web-workbench/use-case/handle-lifecycle-in-workbench.md#close
test('Issue close actions preserve previews and reject invalid inputs before removing the Issue and its markers', async () => {
  const fixture = (await createFixConsumer());
  const issue = join(fixture.root, 'docs/issues/sku.md');
  const regression = join(fixture.root, 'test/cart.test.ts');
  const issueBefore = readFileSync(issue, 'utf8');
  const regressionBefore = readFileSync(regression, 'utf8');
  const action = { action: 'issue.close', id: 'sku', reason: 'Handled with project tools' };
  try {
    for (const fields of [{ fixed: true, dryRun: true }, { defect: 'HEAD~1' }, { fix: 'HEAD' }, { reason: '' }]) {
      await assert.rejects(runApplication(executeViewAction(fixture.root, { ...action, ...fields })), { code: 'InvalidData' });
      assert.equal(readFileSync(issue, 'utf8'), issueBefore);
      assert.equal(readFileSync(regression, 'utf8'), regressionBefore);
    }
    await runApplication(executeViewAction(fixture.root, { ...action, dryRun: true }));
    assert.equal(readFileSync(issue, 'utf8'), issueBefore);
    assert.equal(readFileSync(regression, 'utf8'), regressionBefore);
    await runApplication(executeViewAction(fixture.root, action));
    assert.equal(existsSync(issue), false);
    assert.equal(readFileSync(regression, 'utf8'), '// @feature docs/feature/cart/README.md\nexport const quantity = 2;\n');
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});
