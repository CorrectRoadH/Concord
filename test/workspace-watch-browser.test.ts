import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { createDocument } from '../dist/documents.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import { startViewServer, type ViewServerHandle } from '../dist/view-server.js';
import type { WorkspaceProjection } from '../src/view-contract.js';
import { waitForWorkspaceProjection } from './support.js';

const withWorkspaceBrowser = Effect.fn('withWorkspaceBrowser')((incomplete: boolean, run: (page: Page, origin: string, value: WorkspaceProjection) => Promise<void>) => Effect.tryPromise(async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-workspace-watch-'));
  let browser: Browser | undefined;
  let server: ViewServerHandle | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try {
      initialize(repo, false, { testRoots: [] });
      createDocument(repo, 'feature', { id: 'watch', title: 'Watch fixture', body: '# Watch fixture\n\nOriginal body.\n' });
    } finally { repo.close(); }
    if (incomplete) {
      mkdirSync(join(root, 'docs/feature/broken'));
      writeFileSync(join(root, 'docs/feature/broken/README.md'), '---\nformat: concord.document/v1\nkind: feature\n---\n# Invalid owner\n');
    }
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    const origin = `http://127.0.0.1:${server.port}`;
    const value = await waitForWorkspaceProjection(origin);
    const executablePath = process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await run(page, origin, value);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
}));

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
// @name workspace-watch-drift-and-failures
test('ordinary pages suppress drift while health stays unknown and real diagnostics remain visible', () => Effect.runPromise(withWorkspaceBrowser(true, async (page, origin, actual) => {
  assert.equal(actual.projection.consistent, true);
  assert.equal(actual.projection.complete, false);
  assert.ok(actual.snapshot.findings.some(finding => finding.code === 'InvalidData'));
  const changedPath = 'docs/feature/watch/README.md';
  let served: WorkspaceProjection = { ...actual, projection: { ...actual.projection, consistent: false, complete: false, unknownRelations: true, changedPaths: [changedPath] } };
  // Only the HTTP projection boundary is simulated; documents and diagnostics
  // come from the real repository and the real browser components render them.
  await page.route('**/api/workspace', route => route.fulfill({ json: { ok: true, value: served } }));
  await page.goto(`${origin}/features/watch`);
  await expect(page.getByRole('heading', { name: 'Watch fixture', exact: true })).toBeVisible();
  const notice = page.getByRole('alert').filter({ has: page.getByRole('link', { name: /查看工作区健康/ }) });
  await expect(notice).toHaveCount(0);
  await expect(page.getByText('来源已变化', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/变化路径：/)).toHaveCount(0);
  await page.getByRole('link', { name: '总览', exact: true }).click();
  const health = page.locator('#workspace-health');
  await expect(health.getByText('健康结论未知', { exact: true })).toBeVisible();
  await expect(health).toContainText(changedPath);
  await expect(health.getByText('没有发现结构问题', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '复制全部', exact: true })).toBeDisabled();

  served = actual;
  await page.goto(`${origin}/features/watch`);
  await expect(notice).toContainText('工作区扫描不完整');
  await page.getByRole('link', { name: '总览', exact: true }).click();
  await expect(health.getByText('InvalidData', { exact: true })).toBeVisible();
  for (const status of ['refresh-failed', 'blocked'] as const) {
    served = { ...actual, projection: { ...actual.projection, status, consistent: false, changedPaths: [changedPath], lastError: { failedAt: actual.projection.builtAt, code: status === 'blocked' ? 'RecoveryRequired' : 'WorkspaceWatchUnavailable', message: 'Refresh cannot finish' } } };
    await page.goto(`${origin}/features/watch`);
    await expect(notice).toContainText(status === 'blocked' ? '刷新被恢复状态阻断' : '最近刷新失败');
    await expect(page.getByLabel('工作区投影状态')).toContainText(status === 'blocked' ? '刷新被阻断' : '刷新失败');
    await expect(page.getByText(/变化路径：/)).toHaveCount(0);
  }
})));

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
// @name workspace-watch-polling
test('cached workspace polls every four seconds with independent Git cadence and serialized pending retries', () => Effect.runPromise(withWorkspaceBrowser(false, async (page, origin, actual) => {
  const now = new Date();
  await page.clock.install({ time: new Date(now.getTime() - 1000) });
  await page.clock.pauseAt(now);
  await page.addInitScript(() => {
    const target = window as typeof window & { pollReads: { path: string; at: number }[] };
    target.pollReads = [];
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      if (['/api/workspace', '/api/git', '/api/jobs'].includes(path)) target.pollReads.push({ path, at: Date.now() });
      return fetch(input, init);
    };
  });
  let workspaceReads = 0, gitReads = 0, jobsReads = 0, activeReads = 0, maximumReads = 0;
  let pending = false;
  let hold = false;
  let release: (() => void) | undefined;
  await page.route('**/api/workspace', async route => {
    workspaceReads += 1;
    activeReads += 1;
    maximumReads = Math.max(maximumReads, activeReads);
    try {
      if (hold) await new Promise<void>(resolve => { release = resolve; });
      if (pending) await route.fulfill({ status: 202, json: { ok: false, error: 'WorkspaceProjectionPending', message: 'First generation is pending' } });
      else await route.fulfill({ json: { ok: true, value: actual } });
    } finally { activeReads -= 1; }
  });
  await page.route('**/api/git', async route => { gitReads += 1; await route.continue(); });
  await page.route('**/api/jobs', route => { jobsReads += 1; return route.fulfill({ json: { ok: true, value: [] } }); });
  await page.goto(`${origin}/features/watch`);
  await expect(page.getByRole('heading', { name: 'Watch fixture', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  assert.deepEqual([workspaceReads, gitReads, jobsReads], [1, 1, 1]);
  const tick = async (milliseconds: number, { jobs = false, git = false } = {}) => {
    // Workspace response delivery can precede its chained jobs/Git requests.
    // A previously reached networkidle state is not a barrier for that chain.
    const paths = ['/api/workspace', ...(jobs ? ['/api/jobs'] : []), ...(git ? ['/api/git'] : [])];
    const responses = paths.map(path => page.waitForResponse(response => new URL(response.url()).pathname === path));
    await page.clock.runFor(milliseconds);
    await Promise.all(responses.map(async response => { await (await response).finished(); }));
    await page.waitForLoadState('networkidle');
  };
  for (let cycle = 1; cycle <= 8; cycle += 1) {
    await tick(4000, { jobs: true, git: cycle === 8 });
    assert.deepEqual([workspaceReads, gitReads, jobsReads], [1 + cycle, cycle === 8 ? 2 : 1, 1 + cycle], JSON.stringify(await page.evaluate(() => (window as typeof window & { pollReads: { path: string; at: number }[] }).pollReads)));
  }
  const regularReads = await page.evaluate(() => (window as typeof window & { pollReads: { path: string; at: number }[] }).pollReads);
  for (const path of ['/api/workspace', '/api/jobs', '/api/git']) {
    const times = regularReads.filter(read => read.path === path).map(read => read.at);
    for (let index = 1; index < times.length; index += 1) assert.equal(times[index]! - times[index - 1]!, path === '/api/git' ? 32_000 : 4000, `${path} polling interval`);
  }
  pending = true;
  await tick(4000, { jobs: true });
  await expect(page.getByLabel('工作区投影状态')).toContainText('WorkspaceProjectionPending');
  const pendingJobs = jobsReads;
  await tick(2000);
  assert.equal(jobsReads, pendingJobs, 'pending retries do not double the jobs cadence');
  await tick(2000, { jobs: true });
  assert.equal(jobsReads, pendingJobs + 1);
  assert.equal(gitReads, 2, 'pending retries do not accelerate Git reads');
  pending = false;
  await tick(2000);
  await expect(page.getByLabel('工作区投影状态')).not.toContainText('WorkspaceProjectionPending');

  hold = true;
  await page.clock.runFor(4000);
  await expect.poll(() => activeReads).toBe(1);
  const before = [workspaceReads, gitReads, jobsReads];
  await page.clock.runFor(8000);
  assert.deepEqual([workspaceReads, gitReads, jobsReads], before, 'a slow read holds the next polling cycle');
  hold = false;
  release?.();
  await page.waitForLoadState('networkidle');
  await tick(4000, { jobs: true });
  assert.equal(maximumReads, 1);
})));

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
// @name workspace-watch-preserves-draft
test('navigation polling preserves drafts and a completed write reads after an older poll', () => Effect.runPromise(withWorkspaceBrowser(false, async (page, origin, actual) => {
  const now = new Date();
  await page.clock.install({ time: new Date(now.getTime() - 1000) });
  await page.clock.pauseAt(now);
  let served = actual;
  let releaseSave: (() => void) | undefined;
  let releaseRead: (() => void) | undefined;
  let saving = false;
  let holdRead = false, activeReads = 0, maximumReads = 0, refreshRequests = 0;
  await page.route('**/api/workspace', async route => {
    if (route.request().method() === 'POST') { refreshRequests += 1; await route.continue(); return; }
    const value = served;
    activeReads += 1;
    maximumReads = Math.max(maximumReads, activeReads);
    try {
      if (holdRead) await new Promise<void>(resolve => { releaseRead = resolve; });
      await route.fulfill({ json: { ok: true, value } });
    } finally { activeReads -= 1; }
  });
  await page.route('**/api/action', async route => {
    const action = route.request().postDataJSON() as { action?: string };
    if (action.action === 'document.set') {
      saving = true;
      await new Promise<void>(resolve => { releaseSave = resolve; });
    }
    await route.continue();
  });
  try {
    await page.goto(`${origin}/features/watch`);
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('Original body.');
    await page.waitForLoadState('networkidle');
    await editor.fill('Unsaved watch draft.');
    await expect(page.locator('.editor-shell')).toHaveAttribute('data-dirty', 'true');
    const document = actual.snapshot.documents.find(item => item.path === 'docs/feature/watch/README.md');
    assert.ok(document);
    served = { ...actual, snapshot: { ...actual.snapshot, documents: actual.snapshot.documents.map(item => item === document ? { ...item, metadata: { ...item.metadata, title: 'Updated navigation title' } } : item) } };
    await page.clock.runFor(4000);
    await expect(page.getByRole('complementary', { name: 'Feature 侧栏' }).getByRole('link', { name: 'Updated navigation title', exact: true })).toBeVisible();
    await expect(editor).toContainText('Unsaved watch draft.');
    await expect(page.locator('.editor-shell')).toHaveAttribute('data-dirty', 'true');
    await expect.poll(() => saving).toBe(true);
    holdRead = true;
    await page.clock.runFor(4000);
    await expect.poll(() => activeReads).toBe(1);
    releaseSave?.();
    await expect(page.locator('.editor-shell')).toHaveAttribute('data-dirty', 'false');
    await expect.poll(() => refreshRequests).toBe(1);
    await expect(page.getByLabel('工作区投影状态')).toContainText('导航更新中');
    assert.equal(maximumReads, 1, 'post-write refresh waits behind the older workspace read');
    const builtFrom = await page.evaluate(() => new Date().toISOString());
    served = { ...served, projection: { ...served.projection, builtAt: builtFrom, builtFrom, builtUntil: builtFrom } };
    holdRead = false;
    releaseRead?.();
    await expect(page.getByLabel('工作区投影状态')).not.toContainText('导航更新中');
    await expect(editor).toContainText('Unsaved watch draft.');
    assert.equal(maximumReads, 1);
  } finally { releaseSave?.(); releaseRead?.(); }
})));
