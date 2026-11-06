import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { startViewServer, type ViewServerHandle } from './server.ts';
import { tmpdir } from '../support/temporary.ts';

for (const withCode of [false, true]) {
  // @use-case docs/feature/project-onboarding/use-case/open-uninitialized-repo.md#web
  test(`empty Git onboarding shows only initialization, recommends ${withCode ? 'code' : 'scratch'}, then opens documents`, async ({ page }) => {
    const root = mkdtempSync(join(tmpdir(), 'concord-uninitialized-web-'));
    let server: ViewServerHandle | undefined;
    try {
      execFileSync('git', ['init', '-q', root]);
      if (withCode) { mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src/main.ts'), 'export const answer = 42;\n'); }
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      server = await startViewServer({ root });
      await page.goto(`http://127.0.0.1:${server.port}/features`);
      await expect(page.getByRole('heading', { name: '这个仓库还没有初始化 Concord' })).toBeVisible();
      await expect(page.getByText(`concord --skill docs-from-${withCode ? 'code' : 'scratch'}`, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '初始化 Concord', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Git 变更', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '搜索工作区' })).toHaveCount(0);
      assert.equal(existsSync(join(root, 'docs/taste.md')), false);
      assert.equal(existsSync(join(root, 'AGENTS.md')), false);
      const initialized = page.waitForResponse(response => new URL(response.url()).pathname === '/api/action' && response.request().method() === 'POST');
      await page.getByRole('button', { name: '初始化 Concord', exact: true }).click();
      const response = await initialized;
      assert.equal(response.status(), 200, await response.text());
      await expect(page).toHaveURL(/\/docs(?:\?|$)/u);
      await expect(page.getByRole('link', { name: '文档', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: '这个仓库还没有初始化 Concord' })).toHaveCount(0);
      assert.equal(existsSync(join(root, 'docs/taste.md')), true);
      assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /<!-- BEGIN CONCORD AGENT INSTRUCTIONS -->[\s\S]*<!-- END CONCORD AGENT INSTRUCTIONS -->/u);
      if (withCode) assert.equal(readFileSync(join(root, 'src/main.ts'), 'utf8'), 'export const answer = 42;\n');
      assert.deepEqual(errors, []);
    } finally {
      try {
        await server?.close();
      } finally { rmSync(root, { recursive: true, force: true }); }
    }
  });
}
