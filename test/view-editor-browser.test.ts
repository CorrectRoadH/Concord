import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, expect, type Browser } from '@playwright/test';
import { addPage, createDocument } from '../dist/documents.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import { startViewServer, type ViewServerHandle } from '../dist/view-server.js';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('long documents remain reachable and code blocks follow theme without changing Markdown', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-editor-'));
  let server: ViewServerHandle | undefined;
  let browser: Browser | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try {
      initialize(repo, false, { testRoots: [] });
      createDocument(repo, 'feature', {
        id: 'long', title: 'Long document',
        body: '# Long document\n\n[Read architecture](architecture.md) · [Read engineering](../../engineering/long/)\n\n![Architecture diagram](assets/architecture.png "System architecture")\n\n' + ['ts', 'typescript', 'tsx', 'js', 'json', 'bash', 'yaml', 'python', 'sql'].map((language, index) =>
          '```' + language + '\n' + (index === 0 ? `const answer = "hello";\nconst nowrapProbe = ${'x'.repeat(180)};` : ({ json: '{"value": 42}', bash: 'echo "hello"', yaml: 'value: true', python: 'return "hello"', sql: 'SELECT 42' }[language] ?? 'const answer = "hello";')) + '\n```\n\n').join('') +
          '```text\n+----------------+\n| ASCII preserve |\n+----------------+\n```\n\n' +
          '```mermaid\ngraph TD\n  A[nowrap-' + 'x'.repeat(120) + '] --> B[done]\n```\n\n' +
          Array.from({ length: 80 }, (_, i) => `Paragraph ${i}. Long document content.\n\n`).join('') + 'END OF DOCUMENT\n',
      });
      addPage(repo, 'feature', 'long', 'architecture');
      createDocument(repo, 'engineering', {
        id: 'long', title: 'Long engineering document',
        body: '# Long engineering document\n\n' + Array.from({ length: 80 }, (_, i) => `Paragraph ${i}.\n\n`).join('') + 'ENGINEERING END\n',
      });
    } finally { repo.close(); }
    const file = join(root, 'docs/feature/long/README.md');
    const before = readFileSync(file, 'utf8');
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    const executablePath = process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://127.0.0.1:${server.port}/features/long`);
    await expect(page.getByText('已切换为原文编辑', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('img', { name: 'Architecture diagram', exact: true })).toHaveAttribute('title', 'System architecture');
    const architectureLink = page.getByRole('link', { name: 'Read architecture', exact: true });
    await expect(architectureLink).toHaveCSS('cursor', 'pointer');
    await architectureLink.click();
    assert.equal(new URL(page.url()).pathname, '/features/long');
    await expect(page.getByTestId('document-file-tree').getByRole('button', { name: 'architecture.md', exact: true })).toHaveAttribute('data-active', 'true');
    await page.getByTestId('document-file-tree').getByRole('button', { name: 'README.md', exact: true }).click();
    await page.getByRole('link', { name: 'Read engineering', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/engineering/long$'));
    await expect(page.getByRole('heading', { name: 'Long engineering document', exact: true })).toBeVisible();
    await page.goto(`http://127.0.0.1:${server.port}/features/long`);
    await expect(page.locator('.cm-editor')).toHaveCount(11);
    for (const block of await page.locator('.cm-editor').all()) {
      await expect.poll(() => block.locator('.cm-line').count()).toBeGreaterThan(0);
    }
    const codeWithLongLine = page.locator('.cm-editor').filter({ hasText: 'nowrapProbe' }).first();
    const mermaidWithLongLine = page.locator('.cm-editor').filter({ hasText: 'nowrap-' }).first();
    await expect(page.getByLabel('Mermaid 图表预览').locator('svg')).toBeVisible();
    await expect(mermaidWithLongLine).not.toBeVisible();
    await page.getByText('编辑 Mermaid 源码', { exact: true }).click();
    await expect(mermaidWithLongLine).toBeVisible();
    for (const block of [codeWithLongLine, mermaidWithLongLine]) {
      await expect(block.locator('.cm-scroller')).toHaveCSS('overflow-x', 'auto');
      await expect(block.locator('.cm-line').first()).toHaveCSS('white-space', 'pre');
      assert.equal(await block.locator('.cm-scroller').evaluate(element => element.scrollWidth > element.clientWidth), true, 'long code lines scroll horizontally');
    }
    const ascii = page.locator('.cm-editor').filter({ hasText: 'ASCII preserve' }).first();
    await expect(ascii.locator('.cm-line').filter({ hasText: '| ASCII preserve |' })).toHaveText('| ASCII preserve |');
    await expect(ascii.locator('.cm-line').first()).toHaveCSS('font-family', /monospace/);
    const code = page.locator('.cm-editor').first();
    await code.evaluate(element => element.setAttribute('data-instance', 'preserved'));
    for (const theme of ['dark', 'light'] as const) {
      await page.getByRole('button', { name: theme === 'dark' ? '切换至深色主题' : '切换至浅色主题', exact: true }).click();
      await expect(page.locator('.mdxeditor-popup-container')).toHaveClass(new RegExp(`${theme}-theme`));
      await expect(code).toHaveAttribute('data-instance', 'preserved');
      await expect.poll(() => code.evaluate(element => getComputedStyle(element).backgroundColor === getComputedStyle(element.closest('.editor-shell')!).backgroundColor)).toBe(true);
      const colors = await code.locator('.cm-line span').evaluateAll(elements => elements.map(element => getComputedStyle(element).color));
      assert.ok(new Set(colors).size >= 3, 'keywords, identifiers and strings have distinct colors');
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight), true, 'editor portals must not add blank page height');
      const content = code.locator('.cm-content');
      await content.click();
      await page.keyboard.press('ControlOrMeta+a');
      const selection = code.locator('.cm-selectionBackground').first();
      await expect(selection).toBeVisible();
      const expectedSelection = theme === 'dark' ? 'rgb(38, 59, 61)' : 'rgb(220, 233, 227)';
      await expect(selection).toHaveCSS('background-color', expectedSelection);
      await page.getByRole('tab', { name: '正文', exact: true }).focus();
      await expect(selection).toHaveCSS('background-color', expectedSelection);

    }
    const pane = page.getByTestId('document-file-preview');
    const outerPage = page.locator('.document-workspace > .page');
    await outerPage.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(page.getByText('END OF DOCUMENT', { exact: true })).toBeInViewport();
    assert.ok(await outerPage.evaluate(element => element.scrollTop > 0));
    assert.equal(await pane.evaluate(element => element.scrollHeight === element.clientHeight && getComputedStyle(element).overflowY === 'visible'), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByText('END OF DOCUMENT', { exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByText('END OF DOCUMENT', { exact: true })).toBeInViewport();
    assert.equal(readFileSync(file, 'utf8'), before);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`http://127.0.0.1:${server.port}/engineering/long`);
    await expect(page.getByRole('heading', { name: 'Long engineering document', exact: true })).toBeVisible();
    const bounds = await pane.boundingBox();
    assert.ok(bounds);
    await page.mouse.move(bounds.x + 100, 450);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => outerPage.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const headerTop = await page.getByTestId('document-header').evaluate(element => element.getBoundingClientRect().top);
    const pageTop = await outerPage.evaluate(element => element.getBoundingClientRect().top);
    assert.ok(Math.abs(headerTop - pageTop) < 1, 'sticky toolbar meets the top of the scroll viewport without a content leak');
    assert.equal(await pane.evaluate(element => element.scrollTop), 0, 'wheel scroll belongs to the page, not the editor');
    await outerPage.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(page.getByText('ENGINEERING END', { exact: true })).toBeInViewport();
  } finally {
    await browser?.close();
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
