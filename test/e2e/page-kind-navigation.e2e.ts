import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { createDocument, initialize } from '../support/operations.js';
import { LocalRepository } from '../support/repository.js';
import { tmpdir } from '../support/temporary.js';
import { test } from './fixtures.js';
import { startViewServer, type ViewServerHandle } from './server.js';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('Feature and Engineering kind directories open README and retain deep leaf navigation', async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), 'concord-kind-navigation-'));
  let server: ViewServerHandle | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try {
      initialize(repo, false, { testRoots: [] });
      for (const kind of ['feature', 'engineering'] as const) createDocument(repo, kind, { id: 'cart', title: `${kind} cart`, pages: [] });
    } finally { repo.close(); }
    for (const kind of ['feature', 'engineering']) {
      const directory = join(root, `docs/${kind}/cart/architecture`);
      mkdirSync(directory);
      writeFileSync(join(directory, 'README.md'), `# ${kind} architecture\n`);
      writeFileSync(join(directory, 'storage.md'), `# ${kind} storage\n`);
    }
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    await page.setViewportSize({ width: 1600, height: 1000 });
    for (const [kind, route] of [['feature', 'features'], ['engineering', 'engineering']] as const) {
      const base = `http://127.0.0.1:${server.port}/${route}/cart`;
      const directory = `docs/${kind}/cart/architecture`;
      await page.goto(base);
      const tree = page.getByTestId('document-file-tree');
      const disclosure = tree.getByRole('button', { name: '文件', exact: true });
      if (await disclosure.isVisible()) await disclosure.click();
      await tree.getByRole('button', { name: 'architecture', exact: true }).click();
      await expect(page.getByRole('heading', { name: `${kind} architecture`, exact: true })).toBeVisible();
      assert.equal(new URL(page.url()).searchParams.get('file'), `${directory}/README.md`);
      await expect(tree.getByRole('button', { name: 'architecture/README.md', exact: true })).toHaveCount(0);
      await expect(tree.getByRole('button', { name: 'architecture/storage.md', exact: true })).toBeVisible();
      await tree.getByRole('button', { name: '折叠 architecture', exact: true }).click();
      await expect(tree.getByRole('button', { name: 'architecture/storage.md', exact: true })).toBeHidden();
      assert.equal(new URL(page.url()).searchParams.get('file'), `${directory}/README.md`);
      await tree.getByRole('button', { name: '展开 architecture', exact: true }).click();
      await tree.getByRole('button', { name: 'architecture/storage.md', exact: true }).click();
      await expect(page.getByRole('heading', { name: `${kind} storage`, exact: true })).toBeVisible();
      assert.equal(new URL(page.url()).searchParams.get('file'), `${directory}/storage.md`);
      await page.reload();
      await expect(page.getByRole('heading', { name: `${kind} storage`, exact: true })).toBeVisible();
      await expect(tree.getByRole('button', { name: 'architecture/storage.md', exact: true })).toHaveAttribute('data-active', 'true');
      if (kind === 'engineering') await expect(page.getByRole('tab', { name: '测试', exact: true })).toHaveCount(0);
    }
  } finally { await server?.close(); rmSync(root, { recursive: true, force: true }); }
});
