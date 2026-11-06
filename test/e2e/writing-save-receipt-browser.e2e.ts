import assert from 'node:assert/strict';
import { parseWritingPolicy } from '../../src/model/index.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { type ViewServerHandle } from './server.ts';
import { waitForWorkspaceProjection } from '../support/support.ts';
import { waitForWritingSave } from '../support/writing-save.ts';

// @use-case docs/feature/documentation-quality/use-case/manage-writing.md
test('writing save wait keeps reload behind the successful HTTP receipt', ({ page, workspace }) => Effect.runPromise(Effect.tryPromise(async () => {
  const root = workspace.root;
  let server: ViewServerHandle | undefined;
  let release: (() => void) | undefined;
  let waiting: Promise<void> | undefined;
  try {
    server = await workspace.ready();
    await waitForWorkspaceProjection(`http://127.0.0.1:${server.port}`);
    await page.goto(`http://127.0.0.1:${server.port}/writing`);
    const input = page.getByLabel(/^替换建议 \d+$/u).last();
    await expect(input).toBeVisible();
    let captured!: () => void;
    const capture = new Promise<void>(resolve => { captured = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/action', async route => {
      if (route.request().postDataJSON().action !== 'document.set') return route.continue();
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
    const path = join(root, 'docs/writing.md');
    assert.equal(parseWritingPolicy(readFileSync(path, 'utf8')).bannedTerms.at(-1)?.use, replacement);
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
  }
})));
