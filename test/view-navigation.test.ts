import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, expect } from '@playwright/test';
import { createDocument } from '../dist/documents.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import { startViewServer } from '../dist/view-server.js';
import { readProjectConfig, writeProjectConfig } from './support.js';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('URL navigation saves the latest draft and restores nested drawers without local selection state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-url-navigation-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try {
    initialize(repo, false, { testRoots: [] });
    const body = '# Navigation\n\n' + 'A paragraph for restoring the reading position.\n\n'.repeat(60);
    createDocument(repo, 'feature', { id: 'navigation', title: 'Navigation', body });
    createDocument(repo, 'use-case', { id: 'history', title: 'History', feature: 'navigation', body });
  } finally { repo.close(); }
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/navigation.ts'), '// @concord-file\n// @concord-implements docs/feature/navigation/use-case/history.md\nexport const navigation = true;\n');
  writeProjectConfig(root, { ...readProjectConfig(root), sourceRoots: ['src'] });
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const executablePath = process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
  let release = () => {};
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.port}`;
    await page.goto(`${origin}/features/navigation?tab=metadata`);
    const gate = new Promise<void>(resolve => { release = resolve; });
    let intercepted = false;
    await page.route('**/api/action', async route => {
      if (!intercepted && route.request().postDataJSON().action === 'document.metadata') {
        intercepted = true;
        await gate;
      }
      await route.continue();
    });
    await page.getByLabel('文档标题', { exact: true }).fill('First revision');
    await page.getByRole('tab', { name: '正文', exact: true }).click();
    await expect.poll(() => intercepted).toBe(true);
    await page.getByLabel('文档标题', { exact: true }).fill('Latest revision');
    await page.getByRole('tab', { name: '实现', exact: true }).click();
    release();
    await expect(page.getByRole('tab', { name: '实现', exact: true })).toHaveAttribute('data-state', 'active').catch(async cause => {
      throw new Error(`Navigation failed at ${page.url()}: ${await page.locator('.form-error').allTextContents()}; ${errors}; ${await page.getByLabel('文档标题', { exact: true }).inputValue()}; ${readFileSync(join(root, 'docs/feature/navigation/README.md'), 'utf8')}`, { cause });
    });
    assert.match(readFileSync(join(root, 'docs/feature/navigation/README.md'), 'utf8'), /title: Latest revision/);
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'implementation');
    await page.unroute('**/api/action');

    await page.getByRole('tab', { name: 'Use Cases', exact: true }).click();
    await page.locator('.feature-use-cases').getByRole('link', { name: /History/ }).click();
    const useCase = page.getByRole('dialog', { name: 'History', exact: true });
    await expect(useCase.locator('[contenteditable="true"]').first()).toContainText('A paragraph');
    const drawerBody = useCase.locator('.detail-drawer__body');
    await expect.poll(() => drawerBody.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await drawerBody.evaluate(element => { element.scrollTop = 300; });
    await expect.poll(() => drawerBody.evaluate(element => element.scrollTop), { timeout: 15_000 }).toBe(300);
    await useCase.getByRole('tab', { name: '实现', exact: true }).click();
    await useCase.getByRole('button', { name: /src\/navigation.ts · 第/ }).click();
    const source = page.getByRole('dialog', { name: 'src/navigation.ts', exact: true });
    await expect(source).toBeVisible();
    const nestedUrl = page.url();
    await page.goBack();
    await expect(source).toHaveCount(0);
    await expect(useCase.getByRole('tab', { name: '实现', exact: true })).toHaveAttribute('data-state', 'active');
    await page.goBack();
    await expect(useCase.getByRole('tab', { name: '正文', exact: true })).toHaveAttribute('data-state', 'active');
    await expect.poll(() => drawerBody.evaluate(element => element.scrollTop), { timeout: 15_000 }).toBe(300);
    await page.goForward();
    await expect(useCase.getByRole('tab', { name: '实现', exact: true })).toHaveAttribute('data-state', 'active');
    await page.goForward();
    await expect(source).toBeVisible();
    await page.reload();
    await expect(source.locator('.cm-content')).toContainText('navigation = true');
    await source.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(source).toHaveCount(0);
    await useCase.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/features/navigation?tab=use-cases`);
    await page.goto(nestedUrl);
    await expect(source.locator('.cm-content')).toContainText('navigation = true');
    await source.getByRole('button', { name: 'Close', exact: true }).click();
    await useCase.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/features/navigation?tab=use-cases`);

    await page.goto(`${origin}/settings`);
    const configBefore = readFileSync(join(root, 'concord.config.ts'), 'utf8');
    await page.getByRole('tab', { name: '高级 JSON', exact: true }).click();
    await page.getByLabel('高级项目配置 JSON', { exact: true }).fill('{}');
    await page.goBack();
    await expect(page.getByRole('dialog', { name: '离开并丢弃未保存内容？' })).toBeVisible();
    await expect(page).toHaveURL(`${origin}/settings?tab=advanced`);
    await page.getByRole('button', { name: '留在此页', exact: true }).click();
    await expect(page.getByLabel('高级项目配置 JSON', { exact: true })).toHaveValue('{}');
    await page.getByRole('tab', { name: '常用设置', exact: true }).click();
    await page.getByRole('button', { name: '丢弃并离开', exact: true }).click();
    await expect(page.getByLabel('Project ID', { exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByLabel('高级项目配置 JSON', { exact: true })).not.toHaveValue('{}');
    await page.getByRole('tab', { name: '诊断', exact: true }).click();
    await expect(page.getByRole('heading', { name: '当前诊断', exact: true })).toBeVisible();
    assert.equal(readFileSync(join(root, 'concord.config.ts'), 'utf8'), configBefore);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/features/navigation?tab=body`);
      await expect(page.locator('[contenteditable="true"]').first()).toContainText('A paragraph');
      const container = page.locator(width === 390 ? '.document-workspace' : '.page');
      await container.evaluate(element => { element.scrollTop = 400; });
      await expect.poll(() => container.evaluate(element => element.scrollTop)).toBe(400);
      // The tab bar is sticky, so navigation does not first scroll back to its top.
      await page.getByRole('tab', { name: '元数据', exact: true }).click();
      await expect(page.getByLabel('文档标题', { exact: true })).toBeVisible();
      await page.goBack();
      await expect(page.getByRole('tab', { name: '正文', exact: true })).toHaveAttribute('data-state', 'active');
      await expect.poll(() => container.evaluate(element => element.scrollTop)).toBe(400);
    }
    assert.deepEqual(errors, []);
  } finally {
    release();
    await browser.close();
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
