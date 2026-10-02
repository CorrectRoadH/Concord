import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { chromium, expect, type Browser } from '@playwright/test';
import { initialize, LocalRepository } from '../dist/storage.js';
import { createDocument } from '../dist/documents.js';
import { startViewServer, type ViewServerHandle } from '../dist/view-server.js';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('file context menus copy repository paths without navigating or changing files', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-path menu-'));
  let browser: Browser | undefined;
  let server: ViewServerHandle | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try {
      initialize(repo, false, { testRoots: [] });
      createDocument(repo, 'feature', { id: '菜单', title: '文件菜单', pages: ['architecture', 'use-case'] });
      createDocument(repo, 'feature', { id: 'another', title: '另一项', pages: [] });
    } finally { repo.close(); }
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    const origin = `http://127.0.0.1:${server.port}`;
    const executablePath = process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15_000);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/features/${encodeURIComponent('菜单')}`);
    const url = page.url();
    const path = 'docs/feature/菜单/README.md';
    const before = readFileSync(join(root, path), 'utf8');
    const tree = page.getByTestId('document-file-tree');
    await expect(tree).toBeVisible();
    const disclosure = tree.getByRole('button', { name: '文件', exact: true });
    if (await disclosure.isVisible()) await disclosure.click();
    const selected = tree.getByRole('button', { name: 'README.md', exact: true });
    await selected.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '复制相对路径', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), path);
    assert.equal(page.url(), url);
    await selected.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '复制绝对路径', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), join(root, path));
    const other = page.getByRole('complementary', { name: 'Feature 侧栏' }).getByRole('link', { name: '另一项', exact: true });
    await other.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '复制相对路径', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'docs/feature/another/README.md');
    assert.equal(page.url(), url);
    const folder = tree.getByRole('button', { name: 'use-case', exact: true });
    const expanded = await folder.getAttribute('aria-expanded');
    await folder.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '复制绝对路径', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), join(root, 'docs/feature/菜单/use-case'));
    assert.equal(await folder.getAttribute('aria-expanded'), expanded);
    await selected.focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menuitem', { name: '复制相对路径', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.evaluate("Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => Promise.reject(new Error('denied')) })");
    await selected.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '复制相对路径', exact: true }).click();
    await expect(page.getByText('无法复制路径，请检查浏览器剪贴板权限。')).toBeVisible();
    assert.equal(readFileSync(join(root, path), 'utf8'), before);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server?.close(); rmSync(root, { recursive: true, force: true }); }
})));
