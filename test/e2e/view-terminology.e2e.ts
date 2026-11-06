import assert from 'node:assert/strict';
import { createDocument } from '../support/operations.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from './fixtures.js';
import { expect } from '@playwright/test';
import { LocalRepository } from '../support/repository.js';
import { type ViewServerHandle } from './server.js';

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('terminology tab discards a previous document response and shows scoped JSON diagnostics', async ({ page, workspace }) => {
  const root = workspace.root;
  let server: ViewServerHandle | undefined;

  const repo = new LocalRepository(root);
  try {
    createDocument(repo, 'feature', { id: 'alpha', title: 'Alpha Feature' });
    createDocument(repo, 'feature', { id: 'beta', title: 'Beta Feature' });
  } finally { repo.close(); }
  writeFileSync(join(root, 'docs/concepts.md'), "# Terms\n\n## Shared {#shared}\n\nShared definition\n");
  writeFileSync(join(root, 'docs/feature/alpha/concepts.md'), "# Terms\n\n## Alpha {#alpha}\n\nAlpha definition\n");
  writeFileSync(join(root, 'docs/feature/beta/concepts.md'), "# Terms\n\n## Beta {#beta}\n\nBeta definition\n\n## Shared {#duplicate-shared}\n\nA conflicting scoped definition.\n");
  server = await workspace.ready();

  let legacyReads = 0;
  page.on('request', request => { if (request.url().includes('/api/file') && request.url().includes('concepts.md')) legacyReads++; });
  let releaseAlpha!: () => void;
  let interceptedAlpha!: () => void;
  const heldAlpha = new Promise<void>(resolve => { interceptedAlpha = resolve; });
  const release = new Promise<void>(resolve => { releaseAlpha = resolve; });
  await page.route('**/api/action', async route => {
    const input = route.request().postDataJSON() as { action?: string; path?: string };
    if (input.action === 'concepts.show' && input.path === 'docs/feature/alpha/concepts.md') {
      interceptedAlpha();
      await release;
    }
    await route.continue();
  });
  await page.goto(`http://127.0.0.1:${server.port}/features/alpha?tab=terminology`);
  await heldAlpha;
  const navigation = page.getByRole('navigation', { name: '内容导航', exact: true });
  await navigation.getByRole('link', { name: 'Beta Feature', exact: true }).click();
  await page.getByRole('tab', { name: '术语', exact: true }).click();
  await expect(page.getByText('docs/concepts.md#shared', { exact: true })).toBeVisible();
  await expect(page.getByText('docs/feature/beta/concepts.md#beta', { exact: true })).toBeVisible();
  await expect(page.getByText(/AmbiguousConceptName/u)).toBeVisible();
  const oldResponse = page.waitForResponse(response => response.url().endsWith('/api/action') && (response.request().postDataJSON() as { action?: string; path?: string }).path === 'docs/feature/alpha/concepts.md');
  releaseAlpha();
  await oldResponse;
  await expect(page.getByText('docs/feature/alpha/concepts.md#alpha', { exact: true })).toHaveCount(0);
  await expect(page.getByText('docs/feature/beta/concepts.md#beta', { exact: true })).toBeVisible();
  assert.equal(legacyReads, 0);

});
