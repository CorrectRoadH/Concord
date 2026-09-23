import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { chromium, expect } from '@playwright/test';
import { getViewFile, getWorkspaceSnapshot } from '../dist/application.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import { createDocument } from '../dist/documents.js';
import { readProjectConfig, writeProjectConfig } from './support.js';
import { startViewServer } from '../dist/view-server.js';
import { deriveTestReference } from '../dist/test-reference.js';

// @use-case docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
test('Web derives repository tests from Feature and Use Case paths without importing hosts or changing runner authorization', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-view-profile-'));
  const write = (path: string, body: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body); };
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try {
    initialize(repo, false, { testRoots: [] });
    createDocument(repo, 'feature', { id: 'adapters', title: 'Adapters' });
    createDocument(repo, 'use-case', { id: 'flow', title: 'Flow', feature: 'adapters' });
    createDocument(repo, 'feature', { id: 'unrelated', title: 'Unrelated' });
  } finally { repo.close(); }
  write('concord.repository.json', JSON.stringify({ format: 'concord.repository/v2', host: 'host.ts', suites: [{ id: 'adapter', root: 'acceptance/adapter' }], historyPath: 'acceptance/history.ts', policy: 'concord.native-reliability/v1' }));
  write('host.ts', 'throw new Error("HOST MUST NEVER BE IMPORTED");');
  write('acceptance/adapter/test/adapter.test.ts', `import { it } from 'vitest';
// @use-case docs/feature/adapters/use-case/flow.md
it('SDK adapter flow', () => { throw new Error('DO NOT EXECUTE'); });
`);
  const nativePath = 'acceptance/adapter/test/adapter.test.ts';
  const directId = deriveTestReference(nativePath, nativePath, 'SDK adapter flow');
  const executablePath = process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  try {
    const snapshot = await Effect.runPromise(getWorkspaceSnapshot(root));
    assert.equal(snapshot.repositoryTests?.status, 'ready', JSON.stringify(snapshot.repositoryTests));
    assert.equal(snapshot.repositoryTests?.tests[0]?.contract, 'docs/feature/adapters/use-case/flow.md');
    assert.equal(snapshot.cases.length, 0);
    assert.deepEqual(snapshot.repositoryTests?.tests[0]?.features, ['docs/feature/adapters/README.md']);
    const projectedTestFile = await Effect.runPromise(getViewFile(root, nativePath));
    assert.equal(projectedTestFile.readOnly, true);
    assert.match(projectedTestFile.body, /SDK adapter flow/);
    await assert.rejects(() => Effect.runPromise(getViewFile(root, 'host.ts')), (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'FileNotFound');
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.port}/features/adapters?tab=testing`);
    await expect(page.getByText('SDK adapter flow', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '运行声明命令', exact: true })).toHaveCount(0);
    await expect(page.getByText('Repository 测试', { exact: false })).toHaveCount(0);
    await expect(page.getByText('关联声明不代表测试已运行；命令收据不代表原生 case 覆盖。', { exact: true })).toBeVisible();
    const testRecord = page.locator('.content-record').first();
    await expect(testRecord.locator('details')).not.toHaveAttribute('open', '');
    await testRecord.locator('summary').click();
    await expect(testRecord.getByText('契约', { exact: true })).toBeVisible();
    await expect(testRecord.getByText('执行器', { exact: true })).toHaveCount(0);
    await expect(testRecord.getByText('运行通道', { exact: true })).toHaveCount(0);
    assert.equal('executor' in snapshot.repositoryTests!.tests[0]!, false);
    assert.equal('lanes' in snapshot.repositoryTests!.tests[0]!, false);
    assert.equal(await testRecord.evaluate(element => getComputedStyle(element).borderBottomWidth), '1px');
    await expect(page.getByText('尚未配置通用测试扫描目录。', { exact: false })).toHaveCount(0);
    const testingPanel = page.getByRole('tabpanel', { name: '测试', exact: true });
    await testingPanel.evaluate(element => element.setAttribute('data-browser-instance', 'preserved'));
    await page.getByRole('button', { name: nativePath, exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('SDK adapter flow');
    assert.equal(new URL(page.url()).searchParams.get('source'), nativePath);
    await page.goBack();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goForward();
    await expect(page.getByRole('dialog')).toContainText('SDK adapter flow');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(testingPanel).toHaveAttribute('data-browser-instance', 'preserved');
    await page.getByRole('button', { name: nativePath, exact: true }).click();
    await page.reload();
    await expect(page.getByRole('dialog')).toContainText('SDK adapter flow');
    await expect(page.getByRole('dialog').locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page).toHaveURL(`http://127.0.0.1:${server.port}/features/adapters?tab=testing`);
    await page.getByRole('tab', { name: '实现', exact: true }).click();
    await expect(page.getByText('尚未配置源码声明扫描目录。', { exact: false })).toBeVisible();
    await expect(page.getByText('尚未建立实现关联', { exact: true })).toBeVisible();
    assert.equal(await page.locator('.panel-empty').first().evaluate(element => getComputedStyle(element).borderTopColor === getComputedStyle(element).color), false, 'empty panel separator must not inherit text color');
    const implementationHeading = await page.locator('.panel-header h2').boundingBox();
    await page.getByRole('tab', { name: 'Use Cases', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Use Cases', exact: true })).toBeVisible();
    const useCasesHeading = await page.locator('.panel-header h2').boundingBox();
    assert.ok(implementationHeading && useCasesHeading && Math.abs(implementationHeading.y - useCasesHeading.y) < 1, 'Use Cases and implementation headings align vertically');
    await page.getByRole('tab', { name: '实现', exact: true }).click();
    await expect(page.getByRole('link', { name: 'acceptance/adapter/test/adapter.test.ts（Repository 测试）' })).toHaveCount(0);
    for (const width of [1280, 1920, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'source paths must stay inside the viewport');
      await expect(page.getByRole('button', { name: '添加关联', exact: true }).first()).toBeVisible();
    }

    const sourceBody = '// Padding before declaration\n'.repeat(500) + `// @concord-code
// @concord-implements docs/feature/adapters/README.md
// @concord-implements docs/feature/adapters/use-case/flow.md
export function sendAdapter() { return 'ok'; }
`;
    write('src/adapters.ts', sourceBody);
    writeProjectConfig(root, { ...readProjectConfig(root), sourceRoots: ['src'] });
    await page.setViewportSize({ width: 1280, height: 900 });
    const refreshedWorkspace = page.waitForResponse(response => response.url().endsWith('/api/workspace') && response.request().method() === 'GET');
    await page.goto(`http://127.0.0.1:${server.port}/features/adapters?tab=implementation`);
    const refreshedResponse = await refreshedWorkspace;
    assert.equal(refreshedResponse.status(), 200);
    assert.equal(await refreshedResponse.finished(), null);
    const featureGroup = page.getByRole('region', { name: 'Adapters的实现', exact: true });
    const useCaseGroup = page.getByRole('region', { name: 'Flow的实现', exact: true });
    await expect(featureGroup.getByText('sendAdapter', { exact: true })).toBeVisible();
    await expect(featureGroup.getByText(/声明 ID/)).toHaveCount(0);
    await expect(featureGroup.locator('details')).toHaveCount(0);
    await expect(featureGroup.getByRole('button', { name: '复制 ID', exact: true })).toHaveCount(0);
    await expect(useCaseGroup.getByText('sendAdapter', { exact: true })).toBeVisible();
    await expect(useCaseGroup.getByRole('link', { name: 'Flow', exact: true })).toHaveAttribute('href', '/features/adapters/use-cases/flow');
    await page.getByRole('button', { name: '添加关联', exact: true }).click();
    await page.getByRole('combobox', { name: '实现关联目标', exact: true }).click();
    await page.getByRole('option', { name: 'Flow', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '实现契约引用', exact: true })).toHaveValue('docs/feature/adapters/use-case/flow.md');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await useCaseGroup.evaluate(element => element.setAttribute('data-browser-instance', 'preserved'));
    await useCaseGroup.getByRole('button', { name: 'src/adapters.ts · 第 504–504 行', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const drawer = page.getByRole('dialog');
    const drawerBox = await drawer.boundingBox();
    assert.ok(drawerBox && Math.abs(drawerBox.width - 1100) < 1 && Math.abs(drawerBox.height - 900) < 1, 'drawer fits the desktop viewport within subpixel rounding');
    await expect(drawer.getByText('src/adapters.ts', { exact: true })).toHaveCount(1);
    const activeLine = drawer.locator('.cm-activeLine');
    await expect(activeLine).toHaveText("export function sendAdapter() { return 'ok'; }");
    await expect(activeLine).toBeInViewport();
    await expect(drawer.locator('.cm-activeLineGutter')).toHaveText('504');
    assert.ok(await drawer.locator('.cm-scroller').evaluate(element => element.scrollTop > 0));
    await expect.poll(async () => new Set(await activeLine.locator('span').evaluateAll(elements => elements.map(element => getComputedStyle(element).color))).size,
      { message: 'source keywords, identifiers and strings have distinct colors' }).toBeGreaterThanOrEqual(3);
    assert.equal(readFileSync(join(root, 'src/adapters.ts'), 'utf8'), sourceBody, 'opening and locating source must not save changes');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(useCaseGroup).toHaveAttribute('data-browser-instance', 'preserved');
    await page.goto(`http://127.0.0.1:${server.port}/features/unrelated?tab=testing`);
    await expect(page.getByText('未发现当前契约的关联测试', { exact: true })).toBeVisible();
    await page.close();
    await expect.poll(() => {
      try { const available = new LocalRepository(root); available.close(); return true; }
      catch (cause) { if (cause instanceof Error && 'code' in cause && cause.code === 'RepositoryBusy') return false; throw cause; }
    }).toBe(true);
    await fetch(`http://127.0.0.1:${server.port}/api/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId: directId }) });
    await expect.poll(() => server.jobs.list()[0]?.state).toBe('failed');
    assert.equal(server.jobs.list()[0]?.error?.code, 'CaseNotFound');
    const installation = mkdtempSync(join(tmpdir(), 'concord-profile-package-'));
    try {
      const packed = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({ filename: Schema.String }))))(
        execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', installation], { cwd: resolve('.'), encoding: 'utf8', timeout: 60_000 }),
      );
      writeFileSync(join(installation, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
      execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', join(installation, packed[0]!.filename)], { cwd: installation, encoding: 'utf8', timeout: 60_000 });
      const installed = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ repositoryTests: Schema.Struct({ status: Schema.String, tests: Schema.Array(Schema.Struct({ id: Schema.String })) }) })))(
        execFileSync(process.execPath, [join(installation, 'node_modules/concord-sdlc/dist/entry.js'), '--root', root, '--json', 'workspace', 'show'], { cwd: root, encoding: 'utf8', timeout: 30_000 }),
      );
      assert.equal(installed.repositoryTests.status, 'ready');
      assert.equal(installed.repositoryTests.tests[0]?.id, directId);
    } finally { rmSync(installation, { recursive: true, force: true }); }
    const pendingPath = 'acceptance/adapter/test/pending.test.ts';
    write(pendingPath, `import { it } from 'vitest';
// @use-case docs/feature/adapters/use-case/flow.md
it('duplicate description', () => {});
it('duplicate description', () => {});
`);
    assert.equal((await Effect.runPromise(getWorkspaceSnapshot(root))).repositoryTests?.status, 'failed', 'unannotated duplicate native names remain ambiguous');
    write(pendingPath, `import { it } from 'vitest';
// @use-case docs/feature/adapters/use-case/flow.md
it('second observation', () => { throw new Error('DO NOT EXECUTE'); });
// @feature docs/feature/adapters/README.md
it('feature observation', () => { throw new Error('DO NOT EXECUTE'); });
`);
    const directRelations = await Effect.runPromise(getWorkspaceSnapshot(root));
    assert.equal(directRelations.repositoryTests?.status, 'ready');
    assert.equal(directRelations.repositoryTests?.tests.length, 3);
    assert.equal(new Set(directRelations.repositoryTests?.tests.map(item => item.id)).size, 3);
    assert.equal(directRelations.repositoryTests?.tests.every(item => item.features.includes('docs/feature/adapters/README.md')), true);
    write(pendingPath, `import { it } from 'vitest';
// @feature docs/engineering/testing/adapter.md
it('invalid target', () => {});
`);
    assert.equal((await Effect.runPromise(getWorkspaceSnapshot(root))).repositoryTests?.status, 'failed', 'direct targets must be Feature or Use Case contracts');
    rmSync(join(root, pendingPath));
    write('concord.repository.json', '{"format":"broken"}');
    const failed = await Effect.runPromise(getWorkspaceSnapshot(root));
    assert.equal(failed.repositoryTests?.status, 'failed');
    const failurePage = await browser.newPage();
    await failurePage.goto(`http://127.0.0.1:${server.port}/features/adapters?tab=testing`);
    await expect(failurePage.getByRole('alert')).toContainText('项目测试接入失败');
    await expect(failurePage.getByText('未发现当前契约的关联测试', { exact: true })).toHaveCount(0);
  } finally { await browser.close(); await server.close(); rmSync(root, { recursive: true, force: true }); }
});
