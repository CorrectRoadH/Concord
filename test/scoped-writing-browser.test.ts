import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, expect, type Browser } from '@playwright/test';
import { initialize, LocalRepository } from '../dist/storage.js';
import { startViewServer, type ViewServerHandle } from '../dist/view-server.js';
import { showWriting, setWriting } from '../dist/writing-management.js';
import { showConcepts, setConcepts } from '../dist/concepts.js';

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('real browser isolates scope responses and drafts, keeps partial save conflicts, and notices inherited concept changes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-scoped-writing-browser-'));
  let browser: Browser | undefined;
  let server: ViewServerHandle | undefined;
  const a = 'docs/feature/alpha';
  const b = 'docs/feature/beta';
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try {
      initialize(repo, false, { testRoots: [] });
      mkdirSync(join(root, a), { recursive: true });
      mkdirSync(join(root, b), { recursive: true });
      setWriting(repo, { format: 'concord.writing/v2', bannedTerms: [{ term: 'Old', use: 'Alpha', why: 'scope A' }] }, null, false, `${a}/concord-writing.json`);
      setWriting(repo, { format: 'concord.writing/v2', bannedTerms: [{ term: 'Old', use: 'Beta', why: 'scope B' }] }, null, false, `${b}/concord-writing.json`);
      setConcepts(repo, { format: 'concord.concepts/v1', concepts: [{ id: 'beta', definition: 'Beta definition', names: { en: { preferred: 'Beta' } } }] }, null, false, `${b}/concepts.json`);
      const global = showConcepts(repo);
      setConcepts(repo, { format: 'concord.concepts/v1', concepts: [{ id: 'global', definition: 'Global definition', names: { en: { preferred: 'Global' } } }] }, global.digest, false, 'docs/concepts.json');
    } finally { repo.close(); }
    writeFileSync(join(root, a, 'sample.md'), '# Alpha writing\n\nOld expression in Alpha.\n');
    writeFileSync(join(root, b, 'sample.md'), '# Old in Beta\n\nOld. Global.\n');
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    const executablePath = process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    await page.goto(`http://127.0.0.1:${server.port}/writing`);
    await expect(page.getByRole('heading', { name: '写作与术语' })).toBeVisible();

    let releaseA!: () => void;
    let interceptedA!: () => void;
    const heldA = new Promise<void>(resolve => { interceptedA = resolve; });
    const release = new Promise<void>(resolve => { releaseA = resolve; });
    await page.route('**/api/action', async route => {
      const input = route.request().postDataJSON() as { action?: string; path?: string };
      if (input.action === 'writing.show' && input.path === `${a}/concord-writing.json`) {
        interceptedA();
        await release;
      }
      await route.continue();
    });
    await page.getByLabel('新目录范围').fill(a);
    await page.getByRole('button', { name: '打开范围' }).click();
    await heldA;
    await page.getByLabel('新目录范围').fill(b);
    await page.getByRole('button', { name: '打开范围' }).click();
    await expect(page.getByLabel('替换建议 1')).toHaveValue('Beta');
    releaseA();
    await expect(page.getByLabel('替换建议 1')).toHaveValue('Beta');
    await page.unroute('**/api/action');

    await expect(page.getByText('docs/concepts.json#global').first()).toBeVisible();
    await page.getByLabel('替换建议 1').fill('Beta saved');
    await page.getByLabel('概念定义 1').fill('Beta draft');
    await page.getByLabel('已发现范围').selectOption(a);
    await expect(page.getByRole('dialog', { name: '切换范围并丢弃未保存内容？' })).toBeVisible();
    await page.getByRole('button', { name: '留在当前范围' }).click();
    await expect(page.getByLabel('替换建议 1')).toHaveValue('Beta saved');
    await expect(page.getByLabel('概念定义 1')).toHaveValue('Beta draft');
    await page.getByRole('button', { name: '显式保存政策' }).click();
    await expect.poll(() => JSON.parse(readFileSync(join(root, b, 'concord-writing.json'), 'utf8')).bannedTerms[0]?.use).toBe('Beta saved');
    assert.equal(JSON.parse(readFileSync(join(root, b, 'concord-writing.json'), 'utf8')).roots, undefined);
    await expect(page.getByText('政策已保存。')).toBeVisible();
    await expect(page.getByLabel('概念定义 1')).toHaveValue('Beta draft');

    const external = new LocalRepository(root);
    try {
      const current = showConcepts(external, `${b}/concepts.json`);
      if (current.state !== 'valid') throw new Error('Expected scoped catalog');
      setConcepts(external, { ...current.catalog, concepts: [{ ...current.catalog.concepts[0]!, definition: 'External definition' }] }, current.digest, false, `${b}/concepts.json`);
    } finally { external.close(); }
    await page.getByRole('button', { name: '显式保存概念' }).click();
    await expect(page.getByRole('region', { name: '概念目录编辑' }).getByRole('alert')).toContainText(/changed|变化|前像|Preimage/u);
    await expect(page.getByLabel('概念定义 1')).toHaveValue('Beta draft');
    await expect(page.getByText('政策已保存。')).toBeVisible();

    await page.getByRole('button', { name: '检查已保存文档' }).click();
    await expect(page.getByText(/某次快照的检查结果/)).toBeVisible();
    const changedGlobal = new LocalRepository(root);
    try {
      const current = showConcepts(changedGlobal, 'docs/concepts.json');
      if (current.state !== 'valid') throw new Error('Expected global catalog');
      setConcepts(changedGlobal, { ...current.catalog, concepts: [{ ...current.catalog.concepts[0]!, definition: 'Changed inherited definition' }] }, current.digest, false, 'docs/concepts.json');
    } finally { changedGlobal.close(); }
    await page.getByRole('button', { name: '刷新汇总' }).click();
    await expect(page.getByText(/概念来源已变化/)).toBeVisible();
    await expect(page.getByText(/某次快照的检查结果/)).toHaveCount(0);
    await expect(page.getByLabel('概念定义 1')).toHaveValue('Beta draft');
    const unchanged = new LocalRepository(root);
    try { assert.equal(showWriting(unchanged, `${b}/concord-writing.json`).policy?.bannedTerms[0]?.use, 'Beta saved'); }
    finally { unchanged.close(); }
  } finally { await browser?.close(); await server?.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('real browser can check again after editing invalidates a delayed check response', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-writing-check-race-'));
  let browser: Browser | undefined;
  let server: ViewServerHandle | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try {
      initialize(repo, false, { testRoots: [] });
      setWriting(repo, { format: 'concord.writing/v2', bannedTerms: [{ term: 'Old', use: 'New', why: '统一写法' }] }, null);
    } finally { repo.close(); }
    writeFileSync(join(root, 'docs/sample.md'), '# Sample\n\nOld.\n');
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    const executablePath = process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.port}/writing`);
    await expect(page.getByLabel('替换建议 1')).toHaveValue('New');

    let releaseOld!: () => void;
    let interceptedOld!: () => void;
    const intercepted = new Promise<void>(resolve => { interceptedOld = resolve; });
    const release = new Promise<void>(resolve => { releaseOld = resolve; });
    let first = true;
    await page.route('**/api/action', async route => {
      const input = route.request().postDataJSON() as { action?: string };
      if (input.action === 'writing.check' && first) {
        first = false;
        interceptedOld();
        await release;
      }
      await route.continue();
    });
    await page.getByRole('button', { name: '检查已保存文档' }).click();
    await intercepted;
    await expect(page.getByRole('button', { name: '正在检查…' })).toBeDisabled();
    await page.getByLabel('替换建议 1').fill('Draft');
    await expect(page.getByRole('button', { name: '检查已保存文档' })).toBeEnabled();

    const oldResponse = page.waitForResponse(response => response.url().endsWith('/api/action') && (response.request().postDataJSON() as { action?: string }).action === 'writing.check');
    releaseOld();
    await oldResponse;
    await expect(page.getByText(/某次快照的检查结果/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: '检查已保存文档' })).toBeEnabled();
    await page.getByRole('button', { name: '检查已保存文档' }).click();
    await expect(page.getByText(/某次快照的检查结果/)).toBeVisible();
    await expect(page.getByText('Old.', { exact: true }).first()).toBeVisible();
  } finally { await browser?.close(); await server?.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('real browser creates local policy and structured multilingual concept catalog without global scan roots', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-local-concept-browser-'));
  let browser: Browser | undefined;
  let server: ViewServerHandle | undefined;
  const scope = 'docs/feature/demo';
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try {
      initialize(repo, false, { testRoots: [] });
      mkdirSync(join(root, scope), { recursive: true });
      const global = showConcepts(repo);
      setConcepts(repo, { format: 'concord.concepts/v1', concepts: [{ id: 'global', definition: 'Shared concept', names: { en: { preferred: 'Shared' } } }] }, global.digest, false, 'docs/concepts.json');
    } finally { repo.close(); }
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    const executablePath = process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    await page.goto(`http://127.0.0.1:${server.port}/writing`);
    await page.getByLabel('新目录范围').fill(scope);
    await page.getByRole('button', { name: '打开范围' }).click();
    await expect(page.getByText(`${scope}/concepts.json`)).toBeVisible();
    await page.getByRole('button', { name: '显式初始化概念' }).click();
    await page.getByLabel('显式导入引用').fill('docs/concepts.json#global');
    await page.getByRole('button', { name: '新增概念' }).click();
    await page.getByLabel('概念 ID 1').fill('local');
    await page.getByLabel('概念定义 1').fill('Local definition');
    await page.getByLabel('概念 1 en 首选名称').fill('Local');
    await page.getByLabel('概念 1 en 允许别名').fill('Nearby');
    await page.getByLabel('概念 1 en 弃用名称').fill('Legacy');
    await page.getByLabel('概念 1 新语言代码').fill('zh');
    await page.getByRole('button', { name: '添加语言' }).click();
    await page.getByLabel('概念 1 zh 首选名称').fill('本地');
    await page.getByRole('button', { name: '显式保存概念' }).click();
    await expect.poll(() => JSON.parse(readFileSync(join(root, scope, 'concepts.json'), 'utf8')).concepts[0]?.names.zh?.preferred).toBe('本地');
    const catalog = JSON.parse(readFileSync(join(root, scope, 'concepts.json'), 'utf8')) as { imports: string[]; concepts: { names: { en: { aliases: string[]; deprecated: string[] } } }[] };
    assert.deepEqual(catalog.imports, ['docs/concepts.json#global']);
    assert.deepEqual(catalog.concepts[0]?.names.en.aliases, ['Nearby']);
    assert.deepEqual(catalog.concepts[0]?.names.en.deprecated, ['Legacy']);
    await expect(page.getByText(`${scope}/concepts.json#local`)).toBeVisible();

    await page.getByRole('button', { name: '显式初始化政策' }).click();
    await page.getByLabel('句子长度继承方式').selectOption('clear');
    await page.getByLabel('SVG 样式继承方式').selectOption('clear');
    await page.getByRole('button', { name: '显式保存政策' }).click();
    await expect.poll(() => JSON.parse(readFileSync(join(root, scope, 'concord-writing.json'), 'utf8')).sentenceLength).toBe(null);
    const policy = JSON.parse(readFileSync(join(root, scope, 'concord-writing.json'), 'utf8')) as { roots?: string[]; svgStyle: null };
    assert.equal(policy.roots, undefined);
    assert.equal(policy.svgStyle, null);
  } finally { await browser?.close(); await server?.close(); rmSync(root, { recursive: true, force: true }); }
});
