import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, expect } from '@playwright/test';
import { createDocument } from '../dist/documents.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import { startViewServer } from '../dist/view-server.js';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('polling keeps jobs responsive without continuously rescanning the workspace', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-polling-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try {
    initialize(repo, false, { testRoots: [] });
    createDocument(repo, 'research', { id: 'polling', title: 'Polling study' });
  } finally { repo.close(); }
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const executablePath = process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    const page = await browser.newPage();
    await page.clock.install({ time: 0 });
    await page.clock.pauseAt(1000);
    let requests = 0, jobs = 0;
    page.on('request', request => { if (request.url().endsWith('/api/jobs')) jobs += 1; });
    await page.route('**/api/workspace', async route => {
      requests += 1;
      if (requests > 1) await gate;
      await route.continue();
    });
    await page.goto(`http://127.0.0.1:${server.port}/research/polling`);
    await expect(page.getByRole('heading', { name: 'Polling study', exact: true })).toBeVisible();
    await expect.poll(() => jobs).toBe(1);
    assert.equal(requests, 1, 'mounting the workspace does not fetch it again');
    // Let the initial Git/jobs responses settle before advancing the polling timer.
    await expect(page.locator('[data-sidebar="menu-badge"]').first()).toBeVisible();
    for (let cycle = 2; cycle <= 8; cycle += 1) {
      const response = page.waitForResponse(result => result.url().endsWith('/api/jobs'));
      await page.clock.runFor(4000);
      await response;
      await expect.poll(() => jobs).toBe(cycle);
    }
    assert.equal(requests, 1, 'routine job polling must not rescan the workspace');
    assert.equal(jobs, 8, 'jobs remain responsive between full refreshes');
    await page.clock.runFor(4000);
    await expect.poll(() => requests).toBe(2);
    await page.clock.runFor(12000);
    assert.equal(requests, 2, 'a slow full refresh must not accumulate more workspace requests');
    assert.equal(jobs, 8, 'jobs do not race the workspace portion of a full refresh');
    const completed = page.waitForResponse(response => response.url().endsWith('/api/workspace'));
    release();
    await completed;
  } finally { release(); await browser.close(); await server.close(); rmSync(root, { recursive: true, force: true }); }
});
