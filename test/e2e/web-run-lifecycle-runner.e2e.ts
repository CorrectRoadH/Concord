import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository } from '../support/repository.ts';
import { gitCommand } from '../support/fix-consumer.ts';
import { readProjectConfig, writeProjectConfig, waitForWorkspaceProjection } from '../support/support.ts';

// @use-case docs/feature/web-workbench/use-case/inspect-implementation-and-tests.md#run
// @issue docs/issues/web-test-run-controls.md
test('browser cancels a real runner and runs the same declaration again without persisting a result', async ({ page, workspace }) => {
  const root = workspace.root;
  const repo = new LocalRepository(root);
  try { createDocument(repo, 'feature', { id: 'run', title: 'Real runner' }); } finally { repo.close(); }
  mkdirSync(join(root, 'test'), { recursive: true });
  // The pending timer belongs only to the consumer fixture and is ended by real cancellation.
  writeFileSync(join(root, 'test/run.test.ts'), "// @feature docs/feature/run/README.md\n// @name real-runner\nimport { test } from 'node:test';\nimport { readFileSync, writeFileSync } from 'node:fs';\nimport assert from 'node:assert/strict';\ntest('real-runner', async () => {\n  const mode = readFileSync('runner-mode.txt', 'utf8');\n  writeFileSync('runner-started.txt', mode);\n  if (mode === 'wait') await new Promise<void>(() => { setInterval(() => {}, 1000); });\n  assert.equal(mode, 'pass');\n});\n");
  writeFileSync(join(root, 'runner-mode.txt'), 'wait');
  writeProjectConfig(root, { ...readProjectConfig(root), testRoots: ['test'], runner: { kind: 'node-test', sourceFiles: [], timeoutMs: 5000 } });
  const before = gitCommand(root, 'status', '--porcelain=v1', '--untracked-files=all').split('\n');
  const server = await workspace.ready();
  const origin = `http://127.0.0.1:${server.port}`;
  await waitForWorkspaceProjection(origin);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/features/run?tab=testing`);
  const entry = page.getByRole('listitem').filter({ has: page.getByText('real-runner', { exact: true }) });
  await entry.getByRole('button', { name: '运行测试', exact: true }).click();
  await expect.poll(() => existsSync(join(root, 'runner-started.txt'))).toBe(true);
  await entry.getByRole('button', { name: '取消运行', exact: true }).click();
  await expect(entry.getByRole('status')).toContainText('已取消');
  writeFileSync(join(root, 'runner-mode.txt'), 'pass');
  const result = page.waitForResponse(response => new URL(response.url()).pathname === '/api/jobs' && response.request().method() === 'POST');
  await entry.getByRole('button', { name: '运行测试', exact: true }).click();
  assert.equal((await result).status(), 202);
  await expect(entry.getByRole('status')).toContainText('已完成');
  await expect(entry).toContainText('通过');
  await expect(entry).toContainText('退出码：0');
  assert.deepEqual(gitCommand(root, 'status', '--porcelain=v1', '--untracked-files=all').split('\n').sort(), [...before, '?? runner-started.txt'].sort());
  for (const width of [390, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const run = entry.getByRole('button', { name: '运行测试', exact: true });
    await expect(run).toBeInViewport();
    await expect(run).toBeEnabled();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const bounds = await entry.boundingBox();
    assert.ok(bounds);
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, `test entry stays inside ${width}px viewport: ${JSON.stringify(bounds)}`);
  }
  await page.getByRole('button', { name: '切换至深色主题', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(entry.getByRole('button', { name: '运行测试', exact: true })).toBeInViewport();
  assert.deepEqual(errors, []);
});
