import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { createDocument, initialize } from '../support/operations.ts';
import { LocalRepository } from '../support/repository.ts';
import { gitCommand, gitCommit } from '../support/fix-consumer.ts';
import { readProjectConfig, writeProjectConfig, waitForWorkspaceProjection } from '../support/support.ts';

// @use-case docs/feature/web-workbench/use-case/handle-lifecycle-in-workbench.md#close
test('Issue fixed form runs the frozen defect and fix before deleting the Issue and refuses a green defect', async ({ page, workspace }) => {
  const root = workspace.privateRoot();
  gitCommand(root, 'init', '-q');
  const repo = new LocalRepository(root, { initialize: true });
  try {
    initialize(repo, false, { testRoots: ['test'] });
    createDocument(repo, 'feature', { id: 'cart', title: 'Cart' });
    createDocument(repo, 'issue', { id: 'sku', title: 'Quantity defect' });
  } finally { repo.close(); }
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'test'), { recursive: true });
  writeProjectConfig(root, { ...readProjectConfig(root), sourceRoots: ['src'], runner: { kind: 'node-test', sourceFiles: [], timeoutMs: 5000 } });
  writeFileSync(join(root, 'src/cart.ts'), 'export const quantity = 1;\n');
  gitCommit(root, 'Initial behavior');
  writeFileSync(join(root, 'test/cart.test.ts'), "// @feature docs/feature/cart/README.md\n// @issue docs/issues/sku.md\nimport { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { quantity } from '../src/cart.ts';\ntest('quantity accumulates', () => assert.equal(quantity, 2));\n");
  const defect = gitCommit(root, 'Failing regression');
  writeFileSync(join(root, 'src/cart.ts'), 'export const quantity = 2;\n');
  const fix = gitCommit(root, 'Fix quantity');
  writeFileSync(join(root, 'unrelated.txt'), 'Independent later work\n');
  const laterFix = gitCommit(root, 'Independent later work');
  const server = await workspace.privateServer({ root });
  const origin = `http://127.0.0.1:${server.port}`;
  await waitForWorkspaceProjection(origin);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/feedback/sku?tab=actions`);
  await page.getByLabel('缺陷提交', { exact: true }).fill(fix);
  await page.getByLabel('修复提交', { exact: true }).fill(laterFix);
  await page.getByLabel('Issue 关闭理由', { exact: true }).fill('Quantity verified');
  const refused = page.waitForResponse(response => new URL(response.url()).pathname === '/api/action' && response.request().method() === 'POST');
  await page.getByRole('button', { name: '核验修复并关闭', exact: true }).click();
  const refusal = await refused;
  assert.equal((await refusal.json() as { error: string }).error, 'FixUnverifiable');
  assert.equal(existsSync(join(root, 'docs/issues/sku.md')), true);
  await page.getByLabel('缺陷提交', { exact: true }).fill(defect);
  await page.getByLabel('修复提交', { exact: true }).fill(fix);
  const closed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/action' && response.request().method() === 'POST');
  await page.getByRole('button', { name: '核验修复并关闭', exact: true }).click();
  const response = await closed;
  const result = await response.json() as { ok: boolean; value: { verification: { defect: string; fix: string }; red: { exitCode: number }[]; green: { exitCode: number }[] } };
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual([result.value.verification.defect, result.value.verification.fix, result.value.red[0]!.exitCode, result.value.green[0]!.exitCode], [defect, fix, 1, 0]);
  assert.equal(existsSync(join(root, 'docs/issues/sku.md')), false);
  assert.equal(readFileSync(join(root, 'src/cart.ts'), 'utf8'), 'export const quantity = 2;\n');
  assert.deepEqual(errors, []);
});
