import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, expect, type Browser } from '@playwright/test';
import { createDocument } from '../dist/documents.js';
import { tracePrivateDirectorySync } from '../dist/coordination.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import { startViewServer, type ViewServerHandle } from '../dist/view-server.js';

async function hold(root: string): Promise<ChildProcess> {
  // A real independent process owns the portable lease until stdin closes.
  const child = spawn(process.execPath, ['--input-type=module', '-e', "import { acquireTraceLeaseSync, releaseTraceLeaseSync } from './dist/coordination.js'; const lease=acquireTraceLeaseSync(process.argv[1], 'exclusive', 'contention'); process.stdout.write('held'); process.stdin.resume(); process.stdin.once('end',()=>releaseTraceLeaseSync(lease,'contention'));", root], { stdio: ['pipe', 'pipe', 'inherit'] });
  await once(child.stdout!, 'data');
  return child;
}
async function release(child: ChildProcess): Promise<void> {
  const closed = once(child, 'close');
  child.stdin!.end();
  await closed;
}

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('file reads recover from real lease contention, cancel on navigation, and align tree rows', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-read-contention-'));
  let server: ViewServerHandle | undefined;
  let browser: Browser | undefined;
  let holder: ChildProcess | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try {
      initialize(repo, false, { testRoots: [] });
      createDocument(repo, 'design', { id: 'lease', title: 'Lease', alternatives: ['first'], pages: ['architecture'], body: '# Lease content' });
    } finally { repo.close(); }
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    const executablePath = process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://127.0.0.1:${server.port}/design/lease`);
    const tree = page.getByTestId('document-file-tree');
    const readme = tree.getByRole('button', { name: 'README.md', exact: true });
    const architecture = tree.getByRole('button', { name: 'plans/first/architecture.md', exact: true });
    await expect(architecture).toBeVisible();
    await expect(page.locator('[contenteditable="true"]').first()).toContainText('Lease content');
    const folder = tree.getByRole('button', { name: 'plans', exact: true });
    const [folderIcon, fileIcon, folderLabel, fileLabel] = await Promise.all([
      folder.locator('svg').nth(1).boundingBox(), readme.locator('svg').boundingBox(),
      folder.locator('span').last().boundingBox(), readme.locator('span').last().boundingBox(),
    ]);
    assert.ok(folderIcon && fileIcon && folderLabel && fileLabel);
    assert.ok(Math.abs(folderIcon.x - fileIcon.x) < 1, 'same-depth icons align');
    assert.ok(Math.abs(folderLabel.x - fileLabel.x) < 1, 'same-depth labels align');

    const lockPath = root;
    const busyResponse = () => page.waitForResponse(response => response.url().includes('/api/file?') && response.status() === 409);
    holder = await hold(lockPath);
    const busy = busyResponse();
    await architecture.click();
    assert.equal((await (await busy).json()).error, 'RepositoryBusy');
    await release(holder); holder = undefined;
    await expect(page.locator('[contenteditable="true"]').first()).toBeVisible();
    await expect(page.getByRole('button', { name: '重试', exact: true })).toHaveCount(0);

    holder = await hold(lockPath);
    await readme.click();
    const retry = page.getByRole('button', { name: '重试', exact: true });
    await expect(retry).toBeVisible();
    await release(holder); holder = undefined;
    await retry.click();
    await expect(page.locator('[contenteditable="true"]').first()).toContainText('Lease content');

    holder = await hold(lockPath);
    const interrupted = busyResponse();
    await architecture.click();
    await interrupted;
    await readme.click();
    await release(holder); holder = undefined;
    await expect(page.locator('[contenteditable="true"]').first()).toContainText('Lease content');
    await expect(readme).toHaveAttribute('data-active', 'true');
    await expect(retry).toHaveCount(0);

    holder = await hold(lockPath);
    await page.reload();
    const recover = page.getByRole('button', { name: '恢复中断的发布' });
    await expect(recover).toBeVisible();
    await recover.click();
    await expect(page.getByRole('alert')).toContainText('owner is still alive');
    await release(holder); holder = undefined;
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await expect(page.getByRole('link', { name: '总览', exact: true })).toBeVisible();

    holder = await hold(lockPath);
    const dead = holder;
    const stopped = once(dead, 'close');
    dead.kill('SIGKILL');
    await stopped;
    holder = undefined;
    await page.reload();
    await expect(recover).toBeVisible();
    await recover.click();
    await expect(page.getByRole('link', { name: '总览', exact: true })).toBeVisible();
  } finally {
    if (holder) await release(holder);
    await browser?.close();
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
