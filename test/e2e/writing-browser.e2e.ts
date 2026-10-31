import { initialize } from '../support/operations.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { join } from 'node:path';
import { test } from './fixtures.js';
import { Effect } from 'effect';
import { expect } from '@playwright/test';
import { LocalRepository } from "../support/repository.js";

import { type ViewServerHandle } from './server.js';
import { startViewServer } from './server.js';
import { defaultWritingPolicy } from "../../src/model/index.js";
import { showWriting, setWriting } from "../../src/domain/writing/index.js";
import { waitForWorkspaceProjection } from '../support/support.js';
import { waitForWritingSave } from '../support/writing-save.js';

// @use-case docs/feature/documentation-quality/use-case/apply-controlled-writing.md
test('C24: browser preserves invalid controlled drafts across an in-flight save and checks the saved policy', ({ page }) => Effect.runPromise(Effect.tryPromise(async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-controlled-browser-'));

  let server: ViewServerHandle | undefined;
  let release: (() => void) | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try { initialize(repo, false, { testRoots: [] }); } finally { repo.close(); }
    writeFileSync(join(root, 'docs/sample.md'), 'Read this sentence.\n');
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    await waitForWorkspaceProjection(`http://127.0.0.1:${server.port}`);

    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto(`http://127.0.0.1:${server.port}/writing`);
    await page.getByRole('link', { name: '写作', exact: true }).click();
    const input = page.getByLabel('受控规则 JSON');
    await expect(input).toBeVisible();
    await page.getByLabel('扫描目录', { exact: true }).fill('docs/sample.md');
    const controlled = { language: 'en', sentence: { en: { descriptive: 1 } } };
    await input.fill(JSON.stringify(controlled));
    let intercepted!: () => void;
    const pending = new Promise<void>(resolve => { intercepted = resolve; });
    await page.route('**/api/action', async route => {
      if (route.request().postDataJSON().action !== 'writing.set') return route.continue();
      await new Promise<void>(resolve => { release = resolve; intercepted(); });
      return route.continue();
    });
    await page.getByRole('button', { name: '保存规则' }).click();
    await pending;
    const invalid = '{"sentence":{"en":{"descriptive":0}}}';
    await input.fill(invalid);
    release?.();
    await expect.poll(() => JSON.parse(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8')).controlled).toEqual(controlled);
    await expect(page.getByText(/sentence\/en\/descriptive: 1 — docs\/concord-writing.json\/controlled\/sentence\/en\/descriptive/)).toHaveCount(1);
    await expect(input).toHaveValue(invalid);
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('button', { name: '保存规则' })).toBeDisabled();
    await page.unroute('**/api/action');
    await input.fill(JSON.stringify({ ...controlled, paragraphSentences: 2 }));
    await page.getByRole('button', { name: '保存规则' }).click();
    await expect.poll(() => JSON.parse(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8')).controlled.paragraphSentences).toBe(2);
    await page.getByRole('button', { name: '检查已保存文档' }).click();
    await expect(page.getByText('[descriptiveSentenceLength]', { exact: false })).toBeVisible();
    await page.reload();
    await page.getByRole('link', { name: '写作', exact: true }).click();
    await expect(input).toHaveValue(/paragraphSentences/);
    assert.deepEqual(JSON.parse(await input.inputValue()), { ...controlled, paragraphSentences: 2 });
  } finally { release?.(); await server?.close(); rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/documentation-quality/use-case/manage-writing.md
test('real browser authors writing policy, keeps conflict drafts, and displays saved snapshot findings', async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), 'concord-writing-browser-'));
  const rule = defaultWritingPolicy.bannedTerms.length + 1;

  let server: ViewServerHandle | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try { initialize(repo, false, { testRoots: [] }); } finally { repo.close(); }
    writeFileSync(join(root, 'docs/concepts.md'), "---\ndeprecated:\n  resolve:\n    - Fix\n---\n\n# Terms\n\n## Resolve {#resolve}\n\n处理问题\n");
    writeFileSync(join(root, 'docs/sample.md'), '# Old writing\n\nOld word.\n');
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });

    const first = page;
    await first.setViewportSize({ width: 1440, height: 950 });
    const url = `http://127.0.0.1:${server.port}/writing`;
    await first.goto(url);
    await first.getByRole('link', { name: '写作', exact: true }).click();
    await expect(first.getByRole('complementary', { name: '写作 侧栏' })).toBeVisible();
    await expect(first.getByLabel('句子长度', { exact: true })).toHaveValue('140');
    await expect(first.getByLabel('段落长度', { exact: true })).toHaveValue('320');
    await first.getByRole('button', { name: '新增规则' }).click();
    await first.getByLabel(`禁用写法 ${rule}`).fill('Old');
    await first.getByLabel(`替换建议 ${rule}`).fill('New');
    await first.getByLabel(`理由 ${rule}`).fill('统一术语');
    assert.equal(JSON.parse(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8')).bannedTerms.length, rule - 1);
    await first.getByRole('button', { name: '保存规则' }).click();
    await expect.poll(() => JSON.parse(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8')).bannedTerms.at(-1)?.term).toBe('Old');
    await expect(first.getByText('写作规则已保存。')).toBeVisible();
    await first.getByRole('link', { name: '术语', exact: true }).click();
    await expect(first.getByRole('textbox', { name: '源码原文' })).toContainText('处理问题');
    await expect(first.getByRole('textbox', { name: '源码原文' })).toContainText('Fix');
    await first.getByRole('link', { name: '写作', exact: true }).click();
    await first.getByRole('button', { name: '检查已保存文档' }).click();
    await expect(first.getByText(/某次快照的检查结果/)).toBeVisible();
    await expect(first.getByText('Old word.', { exact: true }).first()).toBeVisible();
    await first.getByLabel(`替换建议 ${rule}`).fill('Newer');
    await expect(first.getByText(/某次快照的检查结果/)).toHaveCount(0);
    await first.getByRole('button', { name: '保存规则' }).click();
    await waitForWritingSave(first, join(root, 'docs/concord-writing.json'), 'Newer');
    await first.reload();
    await first.getByRole('link', { name: '写作', exact: true }).click();
    await expect(first.getByLabel(`替换建议 ${rule}`)).toHaveValue('Newer');

    const second = await page.context().newPage();
    await second.setViewportSize({ width: 1440, height: 950 });
    await second.goto(url);
    await second.getByRole('link', { name: '写作', exact: true }).click();
    await expect(second.getByLabel(`替换建议 ${rule}`)).toHaveValue('Newer');
    await first.getByLabel(`替换建议 ${rule}`).fill('Final');
    await first.getByRole('button', { name: '保存规则' }).click();
    await expect.poll(() => JSON.parse(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8')).bannedTerms.at(-1)?.use).toBe('Final');
    await second.getByLabel(`理由 ${rule}`).fill('草稿理由');
    await second.getByRole('button', { name: '保存规则' }).click();
    await expect(second.locator('.form-error')).toContainText('Writing policy changed');
    await expect(second.getByLabel(`理由 ${rule}`)).toHaveValue('草稿理由');
    await second.getByRole('link', { name: '文档', exact: true }).click();
    await expect(second.getByRole('dialog', { name: '离开并丢弃未保存内容？' })).toBeVisible();
    await second.getByRole('button', { name: '留在此页' }).click();
    await expect(second).toHaveURL(url);
    await expect(second.getByLabel(`理由 ${rule}`)).toHaveValue('草稿理由');
    await second.getByRole('link', { name: '文档', exact: true }).click();
    await second.getByRole('button', { name: '丢弃并离开' }).click();
    await expect(second).toHaveURL(/\/docs/);

    let release: (() => void) | undefined;
    let intercepted!: () => void;
    const interceptedPromise = new Promise<void>(resolve => { intercepted = resolve; });
    await first.route('**/api/action', async route => {
      const input = route.request().postDataJSON() as { action?: string };
      if (input.action !== 'writing.set') return route.continue();
      await new Promise<void>(resolve => { release = resolve; intercepted(); });
      return route.continue();
    });
    await first.getByLabel(`替换建议 ${rule}`).fill('Saved during request');
    await first.getByRole('button', { name: '保存规则' }).click();
    await interceptedPromise;
    await first.getByLabel(`替换建议 ${rule}`).fill('New draft during request');
    release?.();
    await expect.poll(() => JSON.parse(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8')).bannedTerms.at(-1)?.use).toBe('Saved during request');
    await expect(first.getByLabel(`替换建议 ${rule}`)).toHaveValue('New draft during request');
    await expect(first.getByText('写作规则有未保存草稿；检查只读取磁盘上已保存的写作规则。')).toBeVisible();
    await first.unroute('**/api/action');
    await first.getByRole('button', { name: '保存规则' }).click();
    await expect.poll(() => JSON.parse(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8')).bannedTerms.at(-1)?.use).toBe('New draft during request');
    await first.getByRole('button', { name: `删除规则 ${rule}` }).click();
    await first.getByRole('button', { name: '保存规则' }).click();
    await expect.poll(() => JSON.parse(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8')).bannedTerms.length).toBe(rule - 1);
    await expect(first.getByRole('region', { name: '写作规则编辑' }).getByRole('status')).toHaveText('写作规则已保存。');
    await first.reload();
    await first.getByRole('link', { name: '写作', exact: true }).click();
    await expect(first.getByLabel(`禁用写法 ${rule}`)).toHaveCount(0);
  } finally { await server?.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/documentation-quality/use-case/manage-writing.md
test('real browser displays invalid policy bytes and requires an explicit repair save', async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), 'concord-writing-repair-browser-'));

  let server: ViewServerHandle | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try { initialize(repo, false, { testRoots: [] }); } finally { repo.close(); }
    const obsolete = JSON.stringify({ format: 'concord.writing/v3', bannedTerms: [{ term: 'old', use: 'custom', why: 'keep' }], svgTerms: false, svgStyle: null });
    writeFileSync(join(root, 'docs/concord-writing.json'), obsolete);
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });


    await page.goto(`http://127.0.0.1:${server.port}/writing`);
    await page.getByRole('link', { name: '写作', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('svgTerms');
    await expect(page.getByRole('button', { name: '修复规则' })).toBeVisible();
    assert.equal(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8'), obsolete);
    writeFileSync(join(root, 'docs/concord-writing.json'), '{ broken policy');
    await page.getByRole('button', { name: '重新载入' }).click();
    await expect(page.getByText('{ broken policy')).toBeVisible();
    await expect(page.getByText(/原文摘要：/)).toBeVisible();
    await page.getByRole('button', { name: '修复规则' }).click();
    await expect(page.getByText('{ broken policy')).toBeVisible();
    assert.equal(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8'), '{ broken policy');
    const saved = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/action');
    await page.getByRole('button', { name: '保存规则' }).click();
    assert.equal((await saved).status(), 200);
    await expect.poll(() => JSON.parse(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8')).format).toBe('concord.writing/v3');
    await expect(page.getByText('{ broken policy')).toHaveCount(0);
  } finally { await server?.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/documentation-quality/use-case/manage-writing.md
test('post-save derived refresh cannot adopt an unseen writer digest as the draft CAS baseline', async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), 'concord-writing-refresh-race-'));

  let server: ViewServerHandle | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try {
      initialize(repo, false, { testRoots: [] });
      setWriting(repo, { format: 'concord.writing/v3', roots: ['docs'], bannedTerms: [{ term: 'Old', use: 'Seed', why: '初始规则' }] }, showWriting(repo).digest);
    } finally { repo.close(); }
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });


    await page.goto(`http://127.0.0.1:${server.port}/writing`);
    await page.getByRole('link', { name: '写作', exact: true }).click();
    await expect(page.getByLabel('替换建议 1')).toHaveValue('Seed');
    await expect(page.getByLabel('SVG 样式继承方式')).toHaveCount(0);
    let interceptRefresh = true;
    let externalWritten!: () => void;
    const externalWrite = new Promise<void>(resolve => { externalWritten = resolve; });
    await page.route('**/api/action', async route => {
      const input = route.request().postDataJSON() as { action?: string };
      if (input.action === 'writing.show' && interceptRefresh) {
        interceptRefresh = false;
        const other = new LocalRepository(root);
        try {
          const current = showWriting(other);
          if (current.state !== 'valid') throw new Error('Expected saved writing policy');
          setWriting(other, { ...current.policy, bannedTerms: [{ term: 'Old', use: 'External', why: '另一写者' }] }, current.digest);
        } finally { other.close(); }
        externalWritten();
      }
      await route.continue();
    });
    await page.getByLabel('替换建议 1').fill('Saved locally');
    await page.getByRole('button', { name: '保存规则' }).click();
    await externalWrite;
    await expect(page.locator('.form-error')).toContainText('保存后来源又被外部修改');
    await expect(page.getByLabel('替换建议 1')).toHaveValue('Saved locally');
    await page.getByLabel('替换建议 1').fill('Second local');
    await page.getByRole('button', { name: '保存规则' }).click();
    await expect(page.locator('.form-error')).toContainText('Writing policy changed');
    assert.equal(JSON.parse(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8')).bannedTerms[0]?.use, 'External');
  } finally { await server?.close(); rmSync(root, { recursive: true, force: true }); }
});
