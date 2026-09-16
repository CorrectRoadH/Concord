import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, expect } from '@playwright/test';
import { addPage, createDocument } from '../dist/documents.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import { startViewServer } from '../dist/view-server.js';

// @use-case docs/feature/document-packages/use-case/organize-freeform-research.md
test('Research sidebar groups physical topics and file tree opens nested owners with their identity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-research-browser-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try {
    initialize(repo, false, { testRoots: [] });
    const longBody = '\n\n' + 'Study notes.\n\n'.repeat(80);
    createDocument(repo, 'research', { id: 'first', title: 'First independent study', body: '# First independent study' + longBody });
    createDocument(repo, 'research', { id: 'second', title: 'Second independent study', body: '# Second independent study' + longBody });
    for (let index = 0; index < 20; index += 1) addPage(repo, 'research', 'first', `reference-${index}`);
    addPage(repo, 'research', 'second', '材料/笔记');
  } finally { repo.close(); }
  mkdirSync(join(root, 'docs/research/adapters'));
  renameSync(join(root, 'docs/research/first'), join(root, 'docs/research/adapters/first'));
  renameSync(join(root, 'docs/research/second'), join(root, 'docs/research/adapters/second'));
  writeFileSync(join(root, 'docs/research/adapters/README.md'), '# Adapters navigation\n');
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const executablePath = process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
  try {
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
      const page = await browser.newPage({ viewport });
      await page.goto(`http://127.0.0.1:${server.port}/research/first`);
      const navigation = page.getByRole('navigation', { name: '内容导航', exact: true });
      await expect(navigation.getByRole('link', { name: 'adapters', exact: true })).toHaveCount(1);
      await expect(navigation.getByRole('link', { name: 'First independent study', exact: true })).toHaveCount(0);
      const tree = page.getByTestId('document-file-tree');
      await expect(tree).toBeVisible();
      await expect(tree.getByRole('button', { name: 'second', exact: true })).toBeVisible();
      await tree.getByRole('button', { name: 'second/材料', exact: true }).click();
      const secondFile = tree.getByRole('button', { name: 'second/README.md', exact: true });
      await secondFile.scrollIntoViewIfNeeded();
      await tree.evaluate(element => element.setAttribute('data-instance', 'preserved'));
      const scrollTop = await tree.evaluate(element => element.scrollTop);
      assert.ok(scrollTop > 0, 'fixture requires a scrolled file tree');
      await expect(page.getByRole('heading', { name: 'First independent study', exact: true })).toBeVisible();
      await page.locator('.document-workspace > .page').evaluate(element => { element.scrollTop = 600; });
      const treeTop = await tree.evaluate(element => element.getBoundingClientRect().top);
      let releaseFile!: () => void;
      const fileGate = new Promise<void>(resolve => { releaseFile = resolve; });
      await page.route('**/api/file?*', async route => {
        await fileGate;
        await route.continue();
      });
      await tree.getByRole('button', { name: 'second/README.md', exact: true }).click();
      await expect(page).toHaveURL(/\/research\/second\?file=/);
      try {
        await expect(page.getByRole('status', { name: '正在载入文件' })).toBeVisible();
        assert.equal(await tree.evaluate(element => element.getBoundingClientRect().top), treeTop, 'loading does not move the file tree');
      } finally { releaseFile(); }
      await expect(page.getByRole('heading', { name: 'Second independent study', exact: true })).toBeVisible();
      assert.equal(await tree.evaluate(element => element.getBoundingClientRect().top), treeTop, 'loaded content does not move the file tree');
      await expect(tree).toHaveAttribute('data-instance', 'preserved');
      await expect(tree.getByRole('button', { name: 'second/材料', exact: true })).toHaveAttribute('aria-expanded', 'false');
      assert.equal(await tree.evaluate(element => element.scrollTop), scrollTop, 'switching owners preserves file tree scroll');
      await page.unroute('**/api/file?*');
      for (const file of ['first/reference-0.md', 'second/README.md', 'second/材料/笔记.md', 'second/README.md']) {
        const button = tree.getByRole('button', { name: file, exact: true });
        if (file.includes('材料/')) await tree.getByRole('button', { name: 'second/材料', exact: true }).click();
        await button.scrollIntoViewIfNeeded();
        const beforeTop = await tree.evaluate(element => element.getBoundingClientRect().top);
        const samples = tree.evaluate(async element => {
          const positions: number[] = [];
          for (let frame = 0; frame < 45; frame += 1) {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            positions.push(element.getBoundingClientRect().top);
          }
          return positions;
        });
        await button.click();
        await expect(button).toHaveAttribute('data-active', 'true');
        await expect(page.getByRole('status', { name: '正在载入文件' })).toHaveCount(0);
        const positions = await samples;
        const previewTop = await page.getByTestId('document-file-preview').evaluate(element => element.getBoundingClientRect().top);
        assert.ok(Math.abs(previewTop - beforeTop) < 1, `${file}: preview ${previewTop}, tree ${beforeTop}`);
        for (const top of positions) assert.ok(Math.abs(top - beforeTop) < 1, `${file}: tree moved from ${beforeTop} to ${top}`);
      }
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Second independent study', exact: true })).toBeVisible();
      assert.match(readFileSync(join(root, 'docs/research/adapters/second/README.md'), 'utf8'), /id: second/);
      await page.close();
    }
  } finally { await browser.close(); await server.close(); rmSync(root, { recursive: true, force: true }); }
});
