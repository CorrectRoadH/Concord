import assert from 'node:assert/strict';
import { writeConceptFile } from '../support/writing-files.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { expect } from '@playwright/test';
import { test } from './fixtures.js';
import { type ViewServerHandle } from './server.js';

import { LocalRepository } from '../support/repository.js';
import { waitForWorkspaceProjection } from '../support/support.js';
import { showConcepts } from '../../src/domain/concepts/index.js';

// @use-case docs/feature/documentation-quality/use-case/manage-writing.md
test('a late successful concepts index preserves the newer writing report', ({ page, workspace }) => Effect.runPromise(Effect.tryPromise(async () => {
  const root = workspace.root;
  let server: ViewServerHandle | undefined;
  let release: (() => void) | undefined;
  try {
    const scope = 'docs/feature/beta';
    const repo = new LocalRepository(root);
    try {
      writeConceptFile(repo, '# Terms\n\n## Initial {#initial}\n\nInitial definition\n', showConcepts(repo).digest);
      mkdirSync(join(root, scope), { recursive: true });
      writeConceptFile(repo, '# Terms\n\n## Beta {#beta}\n\nBeta definition\n', null, false, `${scope}/concepts.md`);
      writeFileSync(join(root, scope, 'sample.md'), '# Beta\n\nBeta.\n');
    } finally { repo.close(); }
    server = await workspace.ready();
    await waitForWorkspaceProjection(`http://127.0.0.1:${server.port}`);
    const initialIndex = page.waitForResponse(response => new URL(response.url()).pathname === '/api/action' && response.request().postDataJSON().action === 'concepts.index');
    await page.goto(`http://127.0.0.1:${server.port}/writing`);
    await initialIndex;
    await expect(page.getByLabel('替换建议 1', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: '术语', exact: true }).click();
    await expect(page.getByRole('list', { name: '术语列表' }).getByRole('button', { name: /Initial/u })).toBeVisible();
    await page.getByRole('link', { name: '写作', exact: true }).click();
    const other = new LocalRepository(root);
    try {
      const current = showConcepts(other);
      assert.equal(current.state, 'valid');
      writeConceptFile(other, `${current.source}\n## External {#external}\n\nExternal definition\n`, current.digest);
    } finally { other.close(); }
    let captured!: () => void;
    const capture = new Promise<void>(resolve => { captured = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/action', async route => {
      if (route.request().postDataJSON().action !== 'concepts.index') return route.continue();
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      captured();
      await held;
      await route.fulfill({ response });
    });
    await page.getByLabel('新适用范围').fill(scope);
    await page.getByRole('button', { name: '打开范围', exact: true }).click();
    await capture;
    await page.getByRole('button', { name: '检查已保存文档', exact: true }).click();
    await expect(page.getByText(/某次快照的检查结果/u)).toBeVisible();
    release?.();
    await page.getByRole('link', { name: '术语', exact: true }).click();
    await page.getByLabel('筛选术语').fill('External');
    // Seeing this term proves React has applied the held aggregate response.
    await expect(page.getByRole('list', { name: '术语列表' }).getByRole('button', { name: /External/u })).toBeVisible();
    await page.getByRole('link', { name: '写作', exact: true }).click();
    await expect(page.getByText(/某次快照的检查结果/u)).toBeVisible();
    await expect(page.getByText(/术语来源已变化/u)).toHaveCount(0);
  } finally {
    release?.();
  }
})));
