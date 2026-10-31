import { addPage, createDocument, initialize } from '../support/operations.js';
import { Deferred, Effect } from 'effect';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { join } from 'node:path';
import { test } from './fixtures.js';
import { act } from './journey.js';
import { expect } from '@playwright/test';


import { LocalRepository } from "../support/repository.js";

import { type ViewServerHandle } from './server.js';
import { startViewServer } from './server.js';
import { parseWorkspaceProjection, pollUntil, projectConfigPath, readProjectConfig, waitForWorkspaceProjection, writeProjectConfig } from '../support/support.js';// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('browser creates Unicode Feature and Use Case names and restores their encoded routes', { tags: ['journey'] }, async fixtures => {
  const { page } = fixtures;
  const root = mkdtempSync(join(tmpdir(), 'concord-unicode-browser-'));
  let server: ViewServerHandle | undefined;

  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try { initialize(repo); } finally { repo.close(); }
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });

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
  } finally { await server?.close(); rmSync(root, { recursive: true, force: true }); }
});
