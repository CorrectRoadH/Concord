import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from './fixtures.js';
import { act } from './journey.js';
import { expect } from '@playwright/test';
import { createDocument } from "../../src/domain/documents/index.js";
import { initialize, LocalRepository } from "../../src/base/workspace/index.js";
import { startViewServer } from './server.js';
import { waitForWorkspaceProjection } from '../support.js';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
// @name dismissible-workspace-health-navigation
test('incomplete workspace notice opens health diagnostics and dismisses without hiding findings', { tags: ['journey'] }, async fixtures => {
  const { page } = fixtures;
  const root = mkdtempSync(join(tmpdir(), 'concord-health-notice-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try {
    initialize(repo, false, { testRoots: [] });
    createDocument(repo, 'research', { id: 'health', title: 'Health example' });
  } finally { repo.close(); }
  mkdirSync(join(root, 'docs/feature/broken'));
  writeFileSync(join(root, 'docs/feature/broken/README.md'), '---\nformat: concord.document/v1\nkind: feature\nid: broken\n---\n');
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });

  try {

    await page.goto(`http://127.0.0.1:${server.port}/research/health`);
    const notice = page.getByRole('link', { name: /查看工作区健康/ });
    await expect(notice).toBeVisible({ timeout: 15000 });
    await act(fixtures, '通过当前页面的工作区健康提示，打开健康诊断。', () => notice.click());
    await expect(page).toHaveURL(/\/overview#workspace-health$/);
    await expect(page.locator('#workspace-health')).toContainText('docs/feature/broken/README.md');
    await act(fixtures, '关闭工作区健康提示条，保留当前健康诊断页面。', () => page.getByRole('button', { name: '关闭工作区健康提示' }).click());
    await expect(notice).toHaveCount(0);
    await expect(page.locator('#workspace-health')).toContainText('docs/feature/broken/README.md');
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('polling reads the workspace cache with jobs and serializes slow reads', async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), 'concord-polling-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try {
    initialize(repo, false, { testRoots: [] });
    createDocument(repo, 'research', { id: 'polling', title: 'Polling study' });
  } finally { repo.close(); }
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });

  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {

    await waitForWorkspaceProjection(`http://127.0.0.1:${server.port}`);
    await page.clock.install({ time: 0 });
    await page.clock.pauseAt(1000);
    let requests = 0, jobs = 0;
    page.on('request', request => { if (request.url().endsWith('/api/jobs')) jobs += 1; });
    await page.route('**/api/workspace', async route => {
      requests += 1;
      if (requests > 8) await gate;
      await route.continue();
    });
    await page.goto(`http://127.0.0.1:${server.port}/research/polling`);
    await expect(page.getByRole('heading', { name: 'Polling study', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => jobs).toBe(1);
    assert.equal(requests, 1, 'mounting the workspace does not fetch it again');
    // Let the initial Git/jobs responses settle before advancing the polling timer.
    await expect(page.locator('[data-sidebar="menu-badge"]').first()).toBeVisible();
    for (let cycle = 2; cycle <= 8; cycle += 1) {
      const response = page.waitForResponse(result => result.url().endsWith('/api/jobs'));
      await page.clock.runFor(4000);
      await (await response).finished();
      await expect.poll(() => jobs).toBe(cycle);
    }
    assert.equal(requests, 8, 'each routine cycle reads the published workspace cache');
    assert.equal(jobs, 8, 'jobs remain responsive alongside cached workspace reads');
    await page.clock.runFor(4000);
    await expect.poll(() => requests).toBe(9);
    await page.clock.runFor(12000);
    assert.equal(requests, 9, 'a slow cache read must not accumulate more workspace requests');
    assert.equal(jobs, 8, 'jobs do not race the workspace portion of a full refresh');
    const completed = page.waitForResponse(response => response.url().endsWith('/api/workspace'));
    release();
    await completed;
  } finally { release(); await server.close(); rmSync(root, { recursive: true, force: true }); }
});
