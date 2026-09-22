import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, expect, type Browser } from '@playwright/test';
import { initialize, LocalRepository } from '../dist/storage.js';
import { startViewServer, type ViewServerHandle } from '../dist/view-server.js';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('the docs sidebar opens architecture and keeps the constitution read-only', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-project-docs-'));
  let server: ViewServerHandle | undefined;
  let browser: Browser | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try { initialize(repo, false, { testRoots: [] }); } finally { repo.close(); }
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    const executablePath = process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.getByRole('link', { name: '文档', exact: true }).click();
    const preview = page.getByTestId('project-doc-preview');
    await expect(preview.getByRole('heading', { name: 'Project documentation' })).toBeVisible();
    await expect(preview).toContainText('Where facts belong');
    await preview.getByRole('link', { name: 'Architecture', exact: true }).click();
    await expect(preview).toContainText('Components and responsibilities');
    assert.equal(new URL(page.url()).searchParams.get('file'), 'docs/architecture.md');
    const navigation = page.getByRole('navigation', { name: '内容导航' });
    await navigation.getByRole('link', { name: 'Project constitution', exact: true }).click();
    await expect(preview.getByText('No project principles have been adopted.')).toBeVisible();
    await expect(preview.getByText('not compliance evidence')).toBeVisible();
    await expect(preview.locator('[contenteditable="true"]')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '内容导航', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Project architecture', exact: true })).toBeVisible();
    assert.equal(errors.join('\n'), '');
  } finally {
    await browser?.close();
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
