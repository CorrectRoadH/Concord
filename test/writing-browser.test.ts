import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, expect, type Browser } from '@playwright/test';
import { initialize, LocalRepository } from '../dist/storage.js';
import { startViewServer, type ViewServerHandle } from '../dist/view-server.js';
import { defaultWritingPolicy } from '../dist/writing-defaults.js';
import { showWriting, setWriting } from '../dist/writing-management.js';

// @use-case docs/feature/documentation-quality/use-case/manage-writing.md
test('real browser authors writing policy, keeps conflict drafts, and displays saved snapshot findings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-writing-browser-'));
  const rule = defaultWritingPolicy.bannedTerms.length + 1;
  let browser: Browser | undefined;
  let server: ViewServerHandle | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try { initialize(repo, false, { testRoots: [] }); } finally { repo.close(); }
    writeFileSync(join(root, 'docs/concepts.json'), JSON.stringify({ format: 'concord.concepts/v1', concepts: [{ id: 'resolve', definition: '处理问题', names: { en: { preferred: 'Resolve', aliases: ['Solve'], deprecated: ['Fix'] } } }] }));
    writeFileSync(join(root, 'docs/sample.md'), '# Old writing\n\nOld word.\n');
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    const executablePath = process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    const first = await browser.newPage({ viewport: { width: 1440, height: 950 } });
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
    await expect(first.getByLabel('术语定义 1')).toHaveValue('处理问题');
    await expect(first.getByLabel('术语 1 en 弃用名称')).toHaveValue('Fix');
    await first.getByRole('link', { name: '写作', exact: true }).click();
    await first.getByRole('button', { name: '检查已保存文档' }).click();
    await expect(first.getByText(/某次快照的检查结果/)).toBeVisible();
    await expect(first.getByText('Old word.', { exact: true }).first()).toBeVisible();
    await first.getByLabel(`替换建议 ${rule}`).fill('Newer');
    await expect(first.getByText(/某次快照的检查结果/)).toHaveCount(0);
    await first.getByRole('button', { name: '保存规则' }).click();
    await expect.poll(() => JSON.parse(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8')).bannedTerms.at(-1)?.use).toBe('Newer');
    await first.reload();
    await first.getByRole('link', { name: '写作', exact: true }).click();
    await expect(first.getByLabel(`替换建议 ${rule}`)).toHaveValue('Newer');

    const second = await browser.newPage({ viewport: { width: 1440, height: 950 } });
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
    await first.reload();
    await first.getByRole('link', { name: '写作', exact: true }).click();
    await expect(first.getByLabel(`禁用写法 ${rule}`)).toHaveCount(0);
  } finally { await browser?.close(); await server?.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/documentation-quality/use-case/manage-writing.md
test('real browser displays invalid policy bytes and requires an explicit repair save', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-writing-repair-browser-'));
  let browser: Browser | undefined;
  let server: ViewServerHandle | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try { initialize(repo, false, { testRoots: [] }); } finally { repo.close(); }
    const obsolete = JSON.stringify({ format: 'concord.writing/v2', bannedTerms: [{ term: 'old', use: 'custom', why: 'keep' }], svgTerms: false, svgStyle: null });
    writeFileSync(join(root, 'docs/concord-writing.json'), obsolete);
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    const executablePath = process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.port}/writing`);
    await page.getByRole('link', { name: '写作', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('SVG writing checks were removed');
    await expect(page.getByRole('button', { name: '修复规则' })).toHaveCount(0);
    assert.equal(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8'), obsolete);
    writeFileSync(join(root, 'docs/concord-writing.json'), '{ broken policy');
    await page.getByRole('button', { name: '重新载入' }).click();
    await expect(page.getByText('{ broken policy')).toBeVisible();
    await expect(page.getByText(/原文摘要：/)).toBeVisible();
    await page.getByRole('button', { name: '修复规则' }).click();
    await expect(page.getByText('{ broken policy')).toBeVisible();
    assert.equal(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8'), '{ broken policy');
    await page.getByRole('button', { name: '保存规则' }).click();
    await expect.poll(() => JSON.parse(readFileSync(join(root, 'docs/concord-writing.json'), 'utf8')).format).toBe('concord.writing/v2');
    await expect(page.getByText('{ broken policy')).toHaveCount(0);
  } finally { await browser?.close(); await server?.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/documentation-quality/use-case/manage-writing.md
test('post-save derived refresh cannot adopt an unseen writer digest as the draft CAS baseline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-writing-refresh-race-'));
  let browser: Browser | undefined;
  let server: ViewServerHandle | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try {
      initialize(repo, false, { testRoots: [] });
      setWriting(repo, { format: 'concord.writing/v2', roots: ['docs'], bannedTerms: [{ term: 'Old', use: 'Seed', why: '初始规则' }] }, showWriting(repo).digest);
    } finally { repo.close(); }
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    const executablePath = process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage();
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
  } finally { await browser?.close(); await server?.close(); rmSync(root, { recursive: true, force: true }); }
});
