import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from './fixtures.ts';
import { act } from './journey.ts';
import { expect } from '@playwright/test';

import { type ViewServerHandle } from './server.ts';

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('browser creates Unicode Feature and Use Case names and restores their encoded routes', { tags: ['journey'] }, async fixtures => {
  const { page, workspace } = fixtures;
  const root = workspace.root;
  let server: ViewServerHandle | undefined;

  server = await workspace.ready();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://127.0.0.1:${server.port}/features`);
  await act(fixtures, '新建一个 Feature，ID 完整填写“角色NPC”，标题填写“角色”，确认创建。', async () => {
    await page.getByRole('button', { name: '新建 Feature', exact: true }).click();
    await page.getByLabel('Feature ID', { exact: true }).fill('角色NPC');
    await page.getByLabel('Feature 标题', { exact: true }).fill('角色');
    await page.getByRole('dialog').getByRole('button', { name: '创建', exact: true }).click();
  });
  await act(fixtures, '在当前 Feature 中创建 Use Case，ID 完整填写“扩展NPC动作”，标题填写“扩展 NPC 动作”。创建后打开它的详情。', async () => {
    await page.getByRole('tab', { name: 'Use Cases', exact: true }).click();
    await page.getByRole('button', { name: '新建 Use Case', exact: true }).click();
    await page.getByLabel('Use Case ID', { exact: true }).fill('扩展NPC动作');
    await page.getByLabel('Use Case 标题', { exact: true }).fill('扩展 NPC 动作');
    await page.getByRole('dialog').getByRole('button', { name: '创建', exact: true }).click();
    await page.getByRole('link', { name: /扩展 NPC 动作/u }).click();
  });
  await expect(page.getByRole('dialog')).toContainText('扩展 NPC 动作');
  assert.match(decodeURIComponent(new URL(page.url()).pathname), /角色NPC\/use-cases\/扩展NPC动作$/u);
  await page.reload();
  await expect(page.getByRole('dialog')).toContainText('扩展 NPC 动作');
  assert.match(readFileSync(join(root, 'docs/feature/角色NPC/use-case/扩展NPC动作.md'), 'utf8'), /^# 扩展 NPC 动作\n/u);

});
