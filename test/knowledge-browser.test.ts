import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { chromium, expect, type Browser } from '@playwright/test';
import { initialize, LocalRepository } from '../dist/storage.js';
import { startViewServer, type ViewServerHandle } from '../dist/view-server.js';

const ApiResult = Schema.Struct({ ok: Schema.Boolean, value: Schema.optional(Schema.Unknown), error: Schema.optional(Schema.String) });

// @use-case docs/feature/feedback/use-case/manage-local-observations.md
test('HTTP and browser show Local beside remote filters and delete only safe local drafts', () => Effect.runPromise(Effect.tryPromise({
  try: async () => {
    const root = mkdtempSync(join(tmpdir(), 'concord-knowledge-browser-'));
    let server: ViewServerHandle | undefined;
    let browser: Browser | undefined;
    try {
      execFileSync('git', ['init', '-q', root]);
      const repo = new LocalRepository(root, { initialize: true });
      try { initialize(repo, false, { testRoots: [] }); } finally { repo.close(); }
      server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
      const base = `http://127.0.0.1:${server.port}`;
      async function action(input: unknown): Promise<{ readonly ok: boolean; readonly value?: unknown; readonly error?: string }> {
        const response = await fetch(`${base}/api/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
        return Schema.decodeUnknownSync(ApiResult)(await response.json());
      }
      assert.equal((await action({ action: 'document.create', kind: 'issue', id: 'browser-draft', title: 'Browser draft', body: 'Local content.' })).ok, true);
      const index = await action({ action: 'issue.index' });
      assert.equal(index.ok, true);
      assert.equal(JSON.stringify(index.value).includes('"provider":"local"'), true);
      const recall = await action({ action: 'issue.recall', query: 'Local content' });
      assert.equal(JSON.stringify(recall.value).includes('Local content.'), true);

      const executablePath = process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
      browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
      const page = await browser.newPage();
      assert.equal((await action({ action: 'document.create', kind: 'memory', id: 'first-memory', title: 'First memory', body: 'First memory content.', memoryKind: 'note' })).ok, true);
      assert.equal((await action({ action: 'document.create', kind: 'memory', id: 'second-memory', title: 'Second memory', body: 'Second memory content.', memoryKind: 'note' })).ok, true);
      await page.goto(`${base}/memory`);
      const memoryNavigation = page.getByRole('navigation', { name: '内容导航', exact: true });
      await expect(memoryNavigation.getByRole('link', { name: 'First memory', exact: true })).toBeVisible();
      await memoryNavigation.getByRole('link', { name: 'Second memory', exact: true }).click();
      await expect(page.getByTestId('document-file-preview')).toContainText('Second memory content.');
      await expect(memoryNavigation.getByRole('link', { name: 'First memory', exact: true })).toBeVisible();
      await page.reload();
      await expect(memoryNavigation.getByRole('link', { name: 'Second memory', exact: true })).toHaveAttribute('aria-current', 'page');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: '内容导航', exact: true }).click();
      await page.getByRole('dialog').getByRole('link', { name: 'First memory', exact: true }).click();
      await expect(page.getByTestId('document-file-preview')).toContainText('First memory content.');
      await page.setViewportSize({ width: 1440, height: 950 });
      await page.goto(`${base}/feedback`);
      await expect(page.getByRole('link', { name: 'Browser draft' })).toBeVisible();
      await page.getByRole('link', { name: 'Browser draft' }).click();
      await page.getByRole('tab', { name: '来源与关联' }).click();
      await page.getByRole('button', { name: '删除本地草稿' }).click();
      await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click();
      await expect(page.getByRole('link', { name: 'Browser draft' })).toHaveCount(0);
      assert.equal((await action({ action: 'issue.recall', query: 'Local content' })).ok, true);
      assert.equal(JSON.stringify((await action({ action: 'issue.index' })).value).includes('browser-draft'), false);
    } finally {
      await browser?.close();
      await server?.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
  catch: cause => cause instanceof Error ? cause : new Error(String(cause)),
})));
