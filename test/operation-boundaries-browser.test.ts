import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, expect, type Browser } from '@playwright/test';
import { initialize, LocalRepository } from '../dist/storage.js';
import { beginRun, finalizeRun } from '../dist/run-coordination.js';
import { startViewServer, type ViewServerHandle } from '../dist/view-server.js';

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
// @name browser-recovery-and-incomplete-inventory
test('browser preserves blocked recovery and labels incomplete workspace relations', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-boundaries-browser-'));
  let server: ViewServerHandle | undefined, browser: Browser | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try {
      initialize(repo, false, { testRoots: [] });
      const run = repo.snapshot(() => beginRun(root));
      repo.snapshot(() => finalizeRun(root, run, false));
    } finally { repo.close(); }
    mkdirSync(join(root, 'docs/feature/broken'), { recursive: true });
    writeFileSync(join(root, 'docs/feature/broken/README.md'), '---\nformat: concord.document/v1\nkind: feature\n---\n# Broken\n');
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    const executablePath = process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage();
    // Simulate only the initial HTTP read failure. Recovery and subsequent
    // workspace reads go through the real server and repository implementation.
    await page.route('**/api/workspace', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'RepositoryBusy', message: 'Publication requires recovery' }) }));
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.getByRole('button', { name: '恢复中断的发布', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('恢复仍被执行进程清理状态阻塞');
    assert.ok(existsSync(join(root, '.git/concord/runner.lease')));
    await page.unroute('**/api/workspace');
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: '工作区扫描不完整' })).toBeVisible();
    await expect(page.getByText('InvalidData', { exact: true })).toBeVisible();
  } finally {
    await browser?.close();
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
