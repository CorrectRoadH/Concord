import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, expect, type Browser } from '@playwright/test';
import { initialize, LocalRepository } from '../dist/storage.js';
import { startViewServer, type ViewServerHandle } from '../dist/view-server.js';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('project Markdown deep links edit and persist custom paths, frontmatter and constitution source', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-project-docs-'));
  let server: ViewServerHandle | undefined;
  let browser: Browser | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try { initialize(repo, false, { testRoots: [] }); } finally { repo.close(); }
    mkdirSync(join(root, 'docs/说明'), { recursive: true });
    const paths = ['docs/作者边界.md', 'docs/说明/嵌套.md', 'docs/constitution.md'];
    writeFileSync(join(root, paths[0]!), '# 作者边界\n\n原始正文。\n');
    writeFileSync(join(root, paths[1]!), '---\ntitle: 嵌套文档\n---\n# 嵌套文档\n');
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    const executablePath = process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const path of paths) {
      const before = readFileSync(join(root, path), 'utf8');
      const workspace = page.waitForResponse(response => new URL(response.url()).pathname === '/api/workspace', { timeout: 65000 });
      await page.goto(`http://127.0.0.1:${server.port}/docs?file=${encodeURIComponent(path)}`);
      const firstStatus = (await workspace).status();
      assert.ok([200, 202].includes(firstStatus), `workspace response was ${firstStatus}`);
      const editor = page.getByTestId('project-doc-preview');
      if (path === paths[0]) {
        const text = editor.locator('[contenteditable="true"]').first();
        await expect(text).toContainText('原始正文');
        assert.equal(readFileSync(join(root, path), 'utf8'), before);
        await text.fill('通过浏览器保存作者边界。');
      } else {
        const text = editor.getByLabel('Markdown 原文');
        await expect(text).toHaveValue(before);
        assert.equal(readFileSync(join(root, path), 'utf8'), before);
        await text.fill(`${before}\n通过浏览器保存。\n`);
      }
      await expect.poll(() => readFileSync(join(root, path), 'utf8'), { timeout: 15000 }).toContain('通过浏览器保存');
      if (path !== paths[0]) assert.equal(readFileSync(join(root, path), 'utf8'), `${before}\n通过浏览器保存。\n`);
      const reloadedWorkspace = page.waitForResponse(response => new URL(response.url()).pathname === '/api/workspace', { timeout: 65000 });
      await page.reload();
      const reloadedStatus = (await reloadedWorkspace).status();
      assert.ok([200, 202].includes(reloadedStatus), `workspace response was ${reloadedStatus}`);
      if (path === paths[0]) await expect(editor.locator('[contenteditable="true"]').first()).toContainText('通过浏览器保存');
      else await expect(editor.getByLabel('Markdown 原文')).toHaveValue(`${before}\n通过浏览器保存。\n`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
