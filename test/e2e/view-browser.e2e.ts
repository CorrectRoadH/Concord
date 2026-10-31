import { addPage, createDocument, initialize } from '../support/operations.js';
import { Deferred, Effect } from 'effect';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { join } from 'node:path';
import { test } from './fixtures.js';
import { act } from './journey.js';
import { expect } from '@playwright/test';


import { LocalRepository } from "../support/repository.js";

import { type ViewServerHandle } from './server.js';
import { startViewServer } from './server.js';
import { parseWorkspaceProjection, pollUntil, projectConfigPath, readProjectConfig, waitForWorkspaceProjection, writeProjectConfig } from '../support/support.js';// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('browser opens and refreshes a deep link without credentials and retries initial load failures', async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), 'concord-browser-open-'));
  let server: ViewServerHandle | undefined;

  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try {
      initialize(repo, false, { testRoots: [] });
      createDocument(repo, 'feature', { id: 'web', title: 'Direct access fixture' });
      createDocument(repo, 'use-case', { id: 'floating-path', title: 'Floating user path', feature: 'web' });
      createDocument(repo, 'engineering', { id: 'floating-tooling', title: 'Floating tooling' });
      createDocument(repo, 'feature', { id: 'child-code', title: 'Feature with child implementation' });
      createDocument(repo, 'use-case', { id: 'implemented', title: 'Implemented child', feature: 'child-code' });
      createDocument(repo, 'feature', { id: 'child-test', title: 'Feature with child test' });
      createDocument(repo, 'use-case', { id: 'tested', title: 'Tested child', feature: 'child-test' });
      createDocument(repo, 'roadmap', { id: 'planned', title: 'Planned direction' });
      createDocument(repo, 'feature', {
        id: 'html',
        title: 'Raw HTML fixture',
        body: '# Raw HTML fixture\n\n<details><summary>More</summary>\n\nContent\n\n</details>\n',
      });
      for (let index = 0; index < 24; index += 1) createDocument(repo, 'feature', { id: `fixture-${index}`, title: `Navigation fixture ${index}` });
    } finally { repo.close(); }
    writeFileSync(join(root, 'docs/concepts.md'), "---\ndeprecated:\n  direct-access:\n    - 旧访问\n---\n\n# Terms\n\n## 直接访问 {#direct-access}\n\n浏览器直接打开工作台\n");
    writeFileSync(join(root, 'docs/feature/web/concepts.md'), "# Terms\n\n## Workbench {#workbench}\n\nWeb Feature 所属定义\n");
    writeFileSync(join(root, 'docs/feature/html/concepts.md'), "# Terms\n\n## HTML Only {#html-only}\n\n相邻 Feature 定义\n");
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'src/child.ts'), '// @concord-file\n// @concord-implements docs/feature/child-code/use-case/implemented.md\nexport const implemented = true;\n');
    writeFileSync(join(root, 'test/child.test.ts'), '// @use-case docs/feature/child-test/use-case/tested.md\n');
    writeProjectConfig(root, { ...readProjectConfig(root), sourceRoots: ['src'], testRoots: ['test'] });
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    await waitForWorkspaceProjection(`http://127.0.0.1:${server.port}`);

    const authorizations: (string | undefined)[] = [];
    const errors: string[] = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname.startsWith('/api/')) authorizations.push(request.headers().authorization);
    });
    page.on('pageerror', error => errors.push(error.message));
    // Exercise HTTP retry behavior with the push transport disconnected.
    await page.route('**/api/events', route => route.abort());
    await page.route('**/api/workspace', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'WorkspaceProjectionUnavailable', message: '工作区暂时不可用' }) }));
    const url = `http://127.0.0.1:${server.port}/features/web`;
    await page.goto(url);
    await expect(page.getByRole('alert')).toHaveText('工作区暂时不可用');
    await expect(page.getByLabel('访问密钥', { exact: true })).toHaveCount(0);
    await page.unroute('**/api/workspace');
    const retriedWorkspace = page.waitForResponse(response => response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/api/workspace' && response.status() === 200);
    const retriedDocument = page.waitForResponse(response => new URL(response.url()).pathname === '/api/file' &&
      new URL(response.url()).searchParams.get('path') === 'docs/feature/web/README.md');
    await page.getByRole('button', { name: '重试', exact: true }).click();
    assert.equal(await (await retriedWorkspace).finished(), null);
    const documentResponse = await retriedDocument;
    assert.equal(documentResponse.status(), 200);
    assert.equal(await documentResponse.finished(), null);
    await expect(page.getByRole('heading', { name: 'Direct access fixture', exact: true })).toBeVisible();
    await expect(page).toHaveURL(url);
    await page.getByRole('link', { name: '总览', exact: true }).click();
    const floating = page.getByText('悬空功能', { exact: true }).locator('xpath=ancestor::*[@data-slot="card"]');
    await expect(floating.getByRole('link', { name: /Direct access fixture/ })).toBeVisible();
    await expect(floating.getByRole('link', { name: /Floating user path/ })).toBeVisible();
    await expect(floating.getByRole('link', { name: /Floating tooling/ })).toBeVisible();
    await expect(floating.getByRole('link', { name: /Feature with child implementation|Implemented child|Feature with child test|Tested child/ })).toHaveCount(0);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${server.port}` });
    await floating.getByRole('button', { name: '复制全部', exact: true }).click();
    await expect(page.getByText(/已复制 \d+ 项悬空功能。/)).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(copied, /- \[Feature\] Direct access fixture — docs\/feature\/web\/README\.md/);
    assert.match(copied, /- \[Use Case\] Floating user path — docs\/feature\/web\/use-case\/floating-path\.md/);
    assert.match(copied, /- \[Engineering\] Floating tooling — docs\/engineering\/floating-tooling\/README\.md/);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
      (window as typeof window & { copiedFallback?: string }).copiedFallback = '';
      document.execCommand = command => {
        if (command !== 'copy') return false;
        (window as typeof window & { copiedFallback?: string }).copiedFallback = (document.activeElement as HTMLTextAreaElement | null)?.value ?? '';
        return true;
      };
    });
    await floating.getByRole('button', { name: '复制全部', exact: true }).click();
    assert.match(await page.evaluate(() => (window as typeof window & { copiedFallback?: string }).copiedFallback ?? ''), /Floating tooling/);
    await floating.getByRole('link', { name: /Floating user path/ }).click();
    await expect(page.getByRole('heading', { name: 'Floating user path', exact: true }).first()).toBeVisible();
    await page.getByRole('tab', { name: '术语', exact: true }).click();
    await expect(page.getByText('docs/feature/web/use-case/concepts.md', { exact: true })).toBeVisible();
    await expect(page.getByText('docs/concepts.md#direct-access', { exact: true })).toBeVisible();
    await expect(page.getByText('docs/feature/web/concepts.md#workbench', { exact: true })).toBeVisible();
    await expect(page.getByText('docs/feature/html/concepts.md#html-only', { exact: true })).toHaveCount(0);
    await page.goto(url);
    const contentNavigation = page.getByRole('navigation', { name: '内容导航', exact: true });
    assert.equal(await contentNavigation.evaluate(element => element.parentElement!.scrollHeight > element.parentElement!.clientHeight), true);
    assert.equal(await contentNavigation.evaluate(element => getComputedStyle(element.parentElement!).scrollbarWidth), 'none');
    const pagePane = page.locator('.document-workspace > .page');
    await contentNavigation.evaluate(element => { element.parentElement!.scrollTop = 160; });
    assert.equal(await contentNavigation.evaluate(element => element.parentElement!.scrollTop), 160);
    assert.equal(await pagePane.evaluate(element => element.scrollTop), 0);
    const themeToggle = page.getByRole('button', { name: '切换至深色主题', exact: true });
    await expect(themeToggle).toBeVisible();
    await themeToggle.click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    assert.equal(await page.evaluate(() => localStorage.getItem('concord-theme')), 'dark');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Direct access fixture', exact: true })).toBeVisible();
    await expect(page).toHaveURL(url);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.getByRole('button', { name: '切换至浅色主题', exact: true })).toBeVisible();
    await expect(page.getByTestId('document-header').getByRole('button', { name: '重新载入', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '术语', exact: true }).click();
    await expect(page.getByText('docs/concepts.md#direct-access', { exact: true })).toBeVisible();
    await expect(page.getByText('docs/feature/web/concepts.md#workbench', { exact: true })).toBeVisible();
    await expect(page.getByText('直接访问', { exact: true })).toBeVisible();
    await expect(page.getByText(/弃用名称：旧访问/u)).toBeVisible();
    await expect(page.getByText('浏览器直接打开工作台', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '打开术语' })).toHaveAttribute('href', '/terms');
    await expect(page.getByText('docs/feature/html/concepts.md#html-only', { exact: true })).toHaveCount(0);
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'terminology');
    await page.getByRole('tab', { name: '实现', exact: true }).click();
    await expect(page.getByRole('tab', { name: '实现', exact: true })).toHaveAttribute('data-state', 'active');
    await page.goBack();
    await expect(page.getByRole('tab', { name: '术语', exact: true })).toHaveAttribute('data-state', 'active');
    await page.goForward();
    await expect(page.getByRole('tab', { name: '实现', exact: true })).toHaveAttribute('data-state', 'active');
    await page.reload();
    await expect(page.getByRole('tab', { name: '实现', exact: true })).toHaveAttribute('data-state', 'active');
    await expect(page.getByRole('tab', { name: '关系', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: '生命周期', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('document-header').getByRole('button', { name: '新建 Feature', exact: true })).toHaveCount(0);
    await expect(contentNavigation.getByRole('button', { name: '新建 Feature', exact: true })).toBeVisible();
    await page.goto(`${url}?tab=actions`);
    await expect(page.getByRole('tab', { name: '元数据', exact: true })).toHaveAttribute('data-state', 'active');
    await expect(page.getByText('路径', { exact: true })).toBeVisible();
    await expect(page.getByText('创建于', { exact: true })).toHaveCount(0);
    let holdWorkspace = true;
    let refreshRequests = 0;
    await page.route('**/api/workspace', async route => {
      if (route.request().method() === 'POST') refreshRequests += 1;
      if (route.request().method() === 'GET' && holdWorkspace) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'WorkspaceProjectionUnavailable', message: 'Cache handle is busy', details: { reason: 'HawdbBusy' } }) });
      } else await route.continue();
    });
    await page.getByLabel('文档标题', { exact: true }).fill('Direct access renamed');
    await page.getByRole('tab', { name: 'Use Cases', exact: true }).click();
    await expect(page.getByRole('heading', { name: '工作区投影不可用', exact: true })).toBeVisible({ timeout: 20000 });
    const requestedRefreshes = refreshRequests;
    holdWorkspace = false;
    await expect(contentNavigation.getByRole('link', { name: 'Direct access renamed', exact: true })).toBeVisible({ timeout: 20000 });
    assert.equal(refreshRequests, requestedRefreshes, 'busy-cache recovery retries reads without requesting another scan');
    await page.unroute('**/api/workspace');
    await page.getByRole('tab', { name: '正文', exact: true }).click();
    await expect(page.locator('.editor-shell > .editor-shell__bar')).toHaveCount(0);
    await contentNavigation.getByRole('link', { name: 'Raw HTML fixture', exact: true }).click();
    await expect(page.getByText('已切换为原文编辑', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Markdown 原文', { exact: true })).toContainText('<details>');
    await page.goto(`http://127.0.0.1:${server.port}/roadmap/planned?tab=actions`);
    await expect(page.getByRole('tab', { name: '生命周期', exact: true })).toHaveAttribute('data-state', 'active');
    await page.getByLabel('采用为 Feature ID', { exact: true }).fill('adopted-direction');
    const adoptedProjection = page.waitForResponse(async response => {
      if (response.request().method() !== 'GET' || new URL(response.url()).pathname !== '/api/workspace' || response.status() !== 200) return false;
      const projection = parseWorkspaceProjection(await response.text());
      return projection?.snapshot.documents.some(document => document.metadata.kind === 'feature' &&
        document.metadata.id === 'adopted-direction') ?? false;
    });
    await page.getByRole('button', { name: '采用 Roadmap', exact: true }).click();
    assert.equal(await (await adoptedProjection).finished(), null);
    await page.goto(`http://127.0.0.1:${server.port}/features/adopted-direction`);
    await expect(page.getByTestId('document-file-preview')).toBeVisible();
    await expect(page.getByRole('heading', { name: '可用操作', exact: true })).toHaveCount(0);
    await expect(page.getByText('Unexpected Application Error!', { exact: true })).toHaveCount(0);
    const configurationPath = join(root, 'concord.config.ts');
    const originalConfiguration = readFileSync(configurationPath, 'utf8');
    const invalidConfiguration = 'export default { broken: ; }';
    writeFileSync(configurationPath, invalidConfiguration);
    await page.request.post(`http://127.0.0.1:${server.port}/api/workspace`, { data: {} });
    await page.goto(`http://127.0.0.1:${server.port}/settings`);
    await expect(page.getByRole('heading', { name: '项目配置无法读取', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('无效配置原文', { exact: true })).toHaveValue(invalidConfiguration);
    await expect(page.getByLabel('无效配置原文', { exact: true })).not.toBeEditable();
    await expect(page.getByRole('button', { name: '初始化', exact: true })).toHaveCount(0);
    assert.equal(readFileSync(configurationPath, 'utf8'), invalidConfiguration);
    writeFileSync(configurationPath, originalConfiguration);
    await page.request.post(`http://127.0.0.1:${server.port}/api/workspace`, { data: {} });
    await page.getByRole('button', { name: '重新载入', exact: true }).click();
    await expect(page.getByLabel('测试目录', { exact: true })).toBeVisible({ timeout: 15_000 });
    assert.ok(authorizations.length > 0);
    assert.ok(authorizations.every(value => value === undefined));
    assert.deepEqual(errors, []);
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
