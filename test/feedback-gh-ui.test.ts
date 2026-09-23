import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, expect, type Browser } from '@playwright/test';
import { initialize, LocalRepository } from '../dist/storage.js';
import { startViewServer, type ViewServerHandle } from '../dist/view-server.js';
import { readProjectConfig, writeProjectConfig } from './support.js';

function savedTransport(root: string, index: number): string | undefined {
  const connection = readProjectConfig(root).feedbackConnections?.[index];
  return connection && 'transport' in connection && typeof connection.transport === 'string' ? connection.transport : undefined;
}

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('GitHub settings keep API defaults and binding while gh detection follows saved drafts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-gh-ui-'));
  let server: ViewServerHandle | undefined;
  let browser: Browser | undefined;
  const checks: string[] = [];
  const savedAtCheck: string[] = [];
  let delayCheck = false;
  let releaseCheck: (() => void) | undefined;
  function releasePendingCheck(): void { releaseCheck?.(); releaseCheck = undefined; }
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try { initialize(repo, false, { testRoots: [] }); } finally { repo.close(); }
    const initial = readProjectConfig(root);
    writeProjectConfig(root, { ...initial, feedbackConnections: [{ id: 'existing', provider: 'github', credentialEnv: 'GITHUB_TOKEN', owner: 'acme', repo: 'demo', repositoryId: '321' }] });
    server = await startViewServer({ root, host: '127.0.0.1', port: 0, ...(process.env.CONCORD_TEST_WEB_ROOT ? { webRoot: process.env.CONCORD_TEST_WEB_ROOT } : {}) });
    const executablePath = process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route('**/api/action', async (route) => {
      const body = route.request().postDataJSON() as { action: string; connection?: string };
      if (body.action !== 'feedback.check') { await route.continue(); return; }
      checks.push(body.connection ?? '');
      savedAtCheck.push(savedTransport(root, body.connection === 'existing' ? 0 : 1) ?? 'api');
      if (delayCheck) await new Promise<void>((resolve) => { releaseCheck = resolve; });
      try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, value: { connectionId: body.connection, provider: 'github', transport: 'gh', target: body.connection === 'existing' ? 'acme/demo' : 'other/repo', checkedAt: '2026-09-23T12:00:00.000Z' } }) }); } catch { /* Aborted requests have no response. */ }
    });
    await page.goto(`http://127.0.0.1:${server.port}/settings?tab=feedback`);
    const existing = page.locator('.content-record').filter({ hasText: 'acme/demo' });
    await expect(existing.getByText('API 环境变量').first()).toBeVisible();
    await expect(existing.getByRole('button', { name: '检测连接' })).toHaveCount(0);
    await page.getByRole('button', { name: '添加连接', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'GitHub 读取方式' })).toContainText('API 环境变量');
    await page.getByRole('combobox', { name: '连接来源' }).click();
    await page.getByRole('option', { name: 'Linear' }).click();
    await expect(page.getByRole('combobox', { name: 'GitHub 读取方式' })).toHaveCount(0);
    await page.getByRole('dialog').getByRole('button', { name: '取消' }).click();
    assert.deepEqual(checks, []);

    await existing.getByRole('button', { name: '编辑连接 existing' }).click();
    await page.getByRole('combobox', { name: 'GitHub 读取方式' }).click();
    await page.getByRole('option', { name: '复用 gh 登录' }).click();
    await expect(page.getByRole('dialog').getByLabel('凭据环境变量')).toHaveCount(0);
    // A concurrent disk edit must reject the draft; checking cannot use the old saved API connection.
    writeProjectConfig(root, { ...readProjectConfig(root), runner: { ...initial.runner, timeoutMs: 54321 } });
    await page.getByRole('button', { name: '保存方式' }).click();
    await existing.getByRole('button', { name: '检测连接' }).click();
    await expect(existing.getByRole('alert')).toBeVisible();
    assert.deepEqual(checks, []);
    assert.equal(savedTransport(root, 0), undefined);
    await page.getByRole('button', { name: '重新载入' }).click();
    await page.getByRole('button', { name: '丢弃并载入' }).click();

    await existing.getByRole('button', { name: '编辑连接 existing' }).click();
    await page.getByRole('combobox', { name: 'GitHub 读取方式' }).click();
    await page.getByRole('option', { name: '复用 gh 登录' }).click();
    await page.getByRole('button', { name: '保存方式' }).click();
    await expect.poll(() => savedTransport(root, 0)).toBe('gh');
    assert.deepEqual(readProjectConfig(root).feedbackConnections?.[0], { id: 'existing', provider: 'github', transport: 'gh', owner: 'acme', repo: 'demo', repositoryId: '321' });
    assert.deepEqual(checks, []);
    await existing.getByRole('button', { name: '检测连接' }).click();
    await expect(existing.getByRole('status')).toContainText('连接正常');
    assert.deepEqual(checks, ['existing']);

    delayCheck = true;
    await existing.getByRole('button', { name: '检测连接' }).click();
    await expect.poll(() => checks.length).toBe(2);
    await existing.getByRole('button', { name: '编辑连接 existing' }).click();
    await page.getByRole('combobox', { name: 'GitHub 读取方式' }).click();
    await page.getByRole('option', { name: 'API 环境变量' }).click();
    await page.getByLabel('凭据环境变量').fill('TEMP_GITHUB_TOKEN');
    await page.getByRole('button', { name: '保存方式' }).click();
    releasePendingCheck(); delayCheck = false;
    await expect.poll(() => readProjectConfig(root).feedbackConnections?.[0]).toMatchObject({ credentialEnv: 'TEMP_GITHUB_TOKEN' });
    await expect(existing.getByRole('status')).toHaveCount(0);
    await existing.getByRole('button', { name: '编辑连接 existing' }).click();
    await page.getByRole('combobox', { name: 'GitHub 读取方式' }).click();
    await page.getByRole('option', { name: '复用 gh 登录' }).click();
    await page.getByRole('button', { name: '保存方式' }).click();
    await expect.poll(() => savedTransport(root, 0)).toBe('gh');
    assert.deepEqual(checks, ['existing', 'existing']);

    await page.getByRole('button', { name: '添加连接', exact: true }).click();
    await page.getByRole('combobox', { name: '连接来源' }).click();
    await page.getByRole('option', { name: 'GitHub' }).click();
    await page.getByLabel('连接 ID', { exact: true }).fill('new-gh');
    await page.getByRole('combobox', { name: 'GitHub 读取方式' }).click();
    await page.getByRole('option', { name: '复用 gh 登录' }).click();
    await expect(page.getByRole('dialog').getByLabel('凭据环境变量')).toHaveCount(0);
    await page.getByLabel('GitHub owner').fill('other');
    await page.getByLabel('GitHub repository').fill('repo');
    await page.getByRole('button', { name: '添加', exact: true }).click();
    const next = page.locator('.content-record').filter({ hasText: 'other/repo' });
    await next.getByRole('button', { name: '检测连接' }).click();
    await expect(next.getByRole('status')).toContainText('连接正常');
    await expect.poll(() => readProjectConfig(root).feedbackConnections?.length).toBe(2);
    assert.deepEqual(readProjectConfig(root).feedbackConnections?.[1], { id: 'new-gh', provider: 'github', transport: 'gh', owner: 'other', repo: 'repo' });
    assert.deepEqual(checks, ['existing', 'existing', 'new-gh']);
    assert.deepEqual(savedAtCheck, ['gh', 'gh', 'gh']);
    delayCheck = true;
    await next.getByRole('button', { name: '检测连接' }).click();
    await expect.poll(() => checks.length).toBe(4);
    await next.getByRole('button', { name: '移除连接 new-gh' }).click();
    releasePendingCheck();
    await expect.poll(() => readProjectConfig(root).feedbackConnections?.length).toBe(1);
    await expect(page.getByText('连接正常 · other/repo')).toHaveCount(0);
    await existing.getByRole('button', { name: '编辑连接 existing' }).click();
    await page.getByRole('combobox', { name: 'GitHub 读取方式' }).click();
    await page.getByRole('option', { name: 'API 环境变量' }).click();
    await page.getByRole('button', { name: '保存方式' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel('凭据环境变量').fill('OTHER_GITHUB_TOKEN');
    await page.getByRole('button', { name: '保存方式' }).click();
    await expect.poll(() => readProjectConfig(root).feedbackConnections?.[0]).toMatchObject({ credentialEnv: 'OTHER_GITHUB_TOKEN' });
    assert.deepEqual(readProjectConfig(root).feedbackConnections?.[0], { id: 'existing', provider: 'github', credentialEnv: 'OTHER_GITHUB_TOKEN', owner: 'acme', repo: 'demo', repositoryId: '321' });
    assert.deepEqual(checks, ['existing', 'existing', 'new-gh', 'new-gh']);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(pageErrors, []);
  } finally { releasePendingCheck(); await browser?.close(); await server?.close(); rmSync(root, { recursive: true, force: true }); }
});
