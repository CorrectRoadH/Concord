import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { expect } from '@playwright/test';
import { test } from './fixtures.js';
import { startViewServer, type ViewServerHandle } from './server.js';
import { initialize } from '../support/operations.js';
import { LocalRepository } from '../support/repository.js';
import { tmpdir } from '../support/temporary.js';
import { waitForWorkspaceProjection } from '../support/support.js';
import { waitForWritingSave } from '../support/writing-save.js';

// @issue docs/issues/writing-reload-before-save-receipt.md
// @use-case docs/feature/documentation-quality/use-case/manage-writing.md
test('writing save wait keeps reload behind the successful HTTP receipt', ({ page }) => Effect.runPromise(Effect.tryPromise(async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-writing-save-receipt-'));
  let server: ViewServerHandle | undefined;
  let release: (() => void) | undefined;
  let waiting: Promise<void> | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try { initialize(repo, false, { testRoots: [] }); } finally { repo.close(); }
    server = await startViewServer({ root, port: 0 });
    await waitForWorkspaceProjection(`http://127.0.0.1:${server.port}`);
    await page.goto(`http://127.0.0.1:${server.port}/writing`);
    const input = page.getByLabel(/^替换建议 \d+$/u).last();
    await expect(input).toBeVisible();
    let captured!: () => void;
    const capture = new Promise<void>(resolve => { captured = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/action', async route => {
      if (route.request().postDataJSON().action !== 'writing.set') return route.continue();
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      captured();
      await held;
      await route.fulfill({ response });
    });
    const replacement = 'Saved after receipt';
    await input.fill(replacement);
    await page.getByRole('button', { name: '保存规则', exact: true }).click();
    await capture;
    const path = join(root, 'docs/concord-writing.json');
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).bannedTerms.at(-1).use, replacement);
    let returned = false;
    waiting = waitForWritingSave(page, path, replacement).then(() => { returned = true; });
    await expect(page.getByText('有未保存更改', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '正在保存…', exact: true })).toBeDisabled();
    assert.equal(returned, false, 'disk publication must not release the reload wait before the HTTP receipt');
    release?.();
    await waiting;
    await expect(page.getByText('有未保存更改', { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(input).toHaveValue(replacement);
  } finally {
    release?.();
    await waiting?.catch(() => undefined);
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
})));
