import { browserActionReceipt } from '../support/browser-save.ts';
import assert from 'node:assert/strict';
import { parseWritingPolicy } from '../../src/model/index.ts';
import { writeConceptFile, writeWritingFile } from '../support/writing-files.ts';

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from './fixtures.ts';
import { expect } from '@playwright/test';
import { LocalRepository } from '../support/repository.ts';
import { type ViewServerHandle } from './server.ts';
import { showWriting } from '../../src/domain/writing/index.ts';
import { showConcepts } from '../../src/domain/concepts/index.ts';
import { waitForWorkspaceProjection } from '../support/support.ts';

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('real browser isolates scope responses and drafts, keeps partial save conflicts, and notices inherited concept changes', async ({ page, workspace }) => {
  const root = workspace.root;

  let server: ViewServerHandle | undefined;
  const a = 'docs/feature/alpha';
  const b = 'docs/feature/beta';

  const repo = new LocalRepository(root);
  try {
    mkdirSync(join(root, a), { recursive: true });
    mkdirSync(join(root, b), { recursive: true });
    writeWritingFile(repo, { bannedTerms: [{ term: 'Old', use: 'Alpha', why: 'scope A' }] }, null, false, `${a}/writing.md`);
    writeWritingFile(repo, { bannedTerms: [{ term: 'Old', use: 'Beta', why: 'scope B' }] }, null, false, `${b}/writing.md`);
    writeConceptFile(repo, "# Terms\n\n## Beta {#beta}\n\nBeta definition\n", null, false, `${b}/concepts.md`);
    const global = showConcepts(repo);
    writeConceptFile(repo, "# Terms\n\n```markdown\n## Example {#global}\n\nAn example only.\n```\n\n## Global {#global}\n\nGlobal definition\n\n## Second {#second}\n\nSecond definition\n", global.digest, false, 'docs/concepts.md');
  } finally { repo.close(); }
  writeFileSync(join(root, a, 'sample.md'), '# Alpha writing\n\nOld expression in Alpha.\n');
  writeFileSync(join(root, b, 'sample.md'), '# Old in Beta\n\nOld. Global.\n');
  server = await workspace.ready();
  await waitForWorkspaceProjection(`http://127.0.0.1:${server.port}`);

  await page.setViewportSize({ width: 1440, height: 950 });
  const catalogResponse = (path: string) => page.waitForResponse(response => {
    if (!response.url().endsWith('/api/action')) return false;
    const input = response.request().postDataJSON() as { action?: string; path?: string };
    return input.action === 'concepts.show' && input.path === path;
  });
  const confirmCatalog = async (response: Awaited<ReturnType<typeof catalogResponse>>) => {
    assert.equal(response.status(), 200, `catalog load: ${await response.text()}`);
    await response.finished();
    console.info('Catalog load receipt', response.request().postDataJSON(), response.request().timing());
  };
  const initialCatalog = catalogResponse('docs/concepts.md');
  const initialScopes = page.waitForResponse(response => response.url().endsWith('/api/action') &&
    (response.request().postDataJSON() as { action?: string }).action === 'writing.index');
  await page.goto(`http://127.0.0.1:${server.port}/terms`);
  assert.equal((await initialScopes).status(), 200);
  await confirmCatalog(await initialCatalog);
  await expect(page.getByRole('complementary', { name: '术语 侧栏' })).toBeVisible();
  const terms = page.getByRole('list', { name: '术语列表' });
  const source = page.getByLabel('源码原文', { exact: true });
  await expect(page.getByRole('list', { name: '生效范围列表' }).getByRole('button', { name: 'feature/beta', exact: true })).toBeVisible();
  await expect(page.getByLabel('新生效范围')).toBeVisible();
  await expect(page.getByRole('button', { name: '管理术语', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '编辑术语', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '源码原文' })).toBeVisible();
  const betaLoaded = catalogResponse(`${b}/concepts.md`);
  await page.getByRole('list', { name: '生效范围列表' }).getByRole('button', { name: 'feature/beta', exact: true }).click();
  await confirmCatalog(await betaLoaded);
  await expect(source).toContainText('Beta definition');
  await page.getByLabel('筛选术语').fill('Global');
  await expect(terms.getByRole('button')).toHaveCount(1);
  const globalLoaded = catalogResponse('docs/concepts.md');
  await terms.getByRole('button', { name: /Global/ }).click();
  await confirmCatalog(await globalLoaded);
  await expect(source).toContainText('Global definition');
  await expect(page.locator('.terminology-editor .cm-activeLine')).toHaveText('## Global {#global}');
  await page.getByLabel('筛选术语').fill('');

  await source.fill(readFileSync(join(root, 'docs/concepts.md'), 'utf8').replace('Global definition', 'Unsaved global'));
  await terms.getByRole('button', { name: /Second/ }).click();
  await expect(source).toContainText('Second definition');
  await terms.getByRole('button', { name: /Global/ }).click();
  await expect(source).toContainText('Unsaved global');
  assert.match(readFileSync(join(root, 'docs/concepts.md'), 'utf8'), /Global definition/u);
  await page.getByRole('list', { name: '生效范围列表' }).getByRole('button', { name: 'feature/beta', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '切换范围并丢弃未保存内容？' })).toBeVisible();
  const betaReloaded = catalogResponse(`${b}/concepts.md`);
  await page.getByRole('button', { name: '丢弃并切换' }).click();
  await confirmCatalog(await betaReloaded);
  await expect(source).toContainText('Beta definition');
  await page.getByLabel('筛选术语').fill('Second');
  const secondLoaded = catalogResponse('docs/concepts.md');
  await terms.getByRole('button', { name: /Second/ }).click();
  await confirmCatalog(await secondLoaded);
  await expect(source).toContainText('Second definition');
  await page.getByLabel('筛选术语').fill('');

  let releaseA!: () => void;
  let interceptedA!: () => void;
  const heldA = new Promise<void>(resolve => { interceptedA = resolve; });
  const release = new Promise<void>(resolve => { releaseA = resolve; });
  await page.route('**/api/action', async route => {
    const input = route.request().postDataJSON() as { action?: string; path?: string };
    if (input.action === 'writing.show' && input.path === `${a}/writing.md`) {
      interceptedA();
      await release;
    }
    await route.continue();
  });
  await page.getByRole('link', { name: '写作', exact: true }).click();
  const stalePolicy = browserActionReceipt(page, 'writing.show', input => input.path === `${a}/writing.md`);
  await page.getByLabel('新生效范围').fill(a);
  await page.getByRole('button', { name: '打开范围' }).click();
  await heldA;
  const betaPolicy = browserActionReceipt(page, 'writing.show', input => input.path === `${b}/writing.md`);
  await page.getByLabel('新生效范围').fill(b);
  await page.getByRole('button', { name: '打开范围' }).click();
  await betaPolicy;
  await expect(page.getByLabel('替换建议 1')).toHaveValue('Beta');
  releaseA();
  await stalePolicy;
  await expect(page.getByLabel('替换建议 1')).toHaveValue('Beta');
  await page.unroute('**/api/action');

  await page.getByRole('link', { name: '术语', exact: true }).click();
  await expect(terms.getByRole('button', { name: /Beta/ })).toBeVisible();
  await page.getByRole('link', { name: '写作', exact: true }).click();
  await page.getByLabel('替换建议 1').fill('Beta saved');
  await page.getByRole('link', { name: '术语', exact: true }).click();
  await source.fill(readFileSync(join(root, b, 'concepts.md'), 'utf8').replace('Beta definition', 'Beta draft'));
  await page.getByRole('list', { name: '生效范围列表' }).getByRole('button', { name: 'feature/alpha', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '切换范围并丢弃未保存内容？' })).toBeVisible();
  await page.getByRole('button', { name: '留在当前范围' }).click();
  await expect(page.getByLabel('替换建议 1')).toHaveValue('Beta saved');
  await expect(source).toContainText('Beta draft');
  await page.getByRole('link', { name: '写作', exact: true }).click();
  const betaPolicySaved = browserActionReceipt(page, 'document.set', input => input.path === `${b}/writing.md` && String(input.body).includes('Beta saved'));
  await page.getByRole('button', { name: '保存规则' }).click();
  await betaPolicySaved;
  await expect.poll(() => parseWritingPolicy(readFileSync(join(root, b, 'writing.md'), 'utf8')).bannedTerms[0]?.use).toBe('Beta saved');
  assert.equal(parseWritingPolicy(readFileSync(join(root, b, 'writing.md'), 'utf8')).roots, undefined);
  await page.getByRole('link', { name: '写作', exact: true }).click();
  await expect(page.getByText('写作规则已保存。')).toBeVisible();
  await expect(source).toContainText('Beta draft');

  const external = new LocalRepository(root);
  try {
    const current = showConcepts(external, `${b}/concepts.md`);
    if (current.state !== 'valid') throw new Error('Expected scoped catalog');
    writeConceptFile(external, current.source.replace('Beta definition', 'External definition'), current.digest, false, `${b}/concepts.md`);
  } finally { external.close(); }
  await page.getByRole('link', { name: '术语', exact: true }).click();
  await page.getByRole('button', { name: '保存术语' }).click();
  await expect(page.getByRole('region', { name: '术语表编辑' }).getByRole('alert')).toContainText(/changed|变化|前像|Preimage/u);
  await expect(source).toContainText('Beta draft');
  await page.getByRole('link', { name: '写作', exact: true }).click();
  await expect(page.getByText('写作规则已保存。')).toBeVisible();

  await page.getByRole('link', { name: '写作', exact: true }).click();
  await page.getByRole('button', { name: '检查已保存文档' }).click();
  await expect(page.getByText(/某次快照的检查结果/)).toBeVisible();
  const changedGlobal = new LocalRepository(root);
  try {
    const current = showConcepts(changedGlobal, 'docs/concepts.md');
    if (current.state !== 'valid') throw new Error('Expected global catalog');
    writeConceptFile(changedGlobal, current.source.replace('Global definition', 'Changed inherited definition'), current.digest, false, 'docs/concepts.md');
  } finally { changedGlobal.close(); }
  await page.getByRole('link', { name: '术语', exact: true }).click();
  await page.getByRole('button', { name: '刷新列表' }).click();
  await expect(page.getByText(/术语来源已变化/)).toBeVisible();
  await expect(page.getByText(/某次快照的检查结果/)).toHaveCount(0);
  await expect(source).toContainText('Beta draft');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '内容导航', exact: true }).click();
  const mobileNavigation = page.getByRole('dialog', { name: '术语 导航' });
  await expect(mobileNavigation.getByRole('list', { name: '术语列表' })).toBeVisible();
  await mobileNavigation.getByRole('button', { name: 'feature/alpha', exact: true }).click();
  await expect(mobileNavigation).not.toBeVisible();
  await expect(page.getByRole('dialog', { name: '切换范围并丢弃未保存内容？' })).toBeVisible();
  await page.getByRole('button', { name: '留在当前范围' }).click();
  await expect(source).toContainText('Beta draft');
  const unchanged = new LocalRepository(root);
  try { assert.equal(showWriting(unchanged, `${b}/writing.md`).policy?.bannedTerms[0]?.use, 'Beta saved'); }
  finally { unchanged.close(); }

});

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('real browser can check again after editing invalidates a delayed check response', async ({ page, workspace }) => {
  const root = workspace.root;

  let server: ViewServerHandle | undefined;

  const repo = new LocalRepository(root);
  try {
    writeWritingFile(repo, { bannedTerms: [{ term: 'Old', use: 'New', why: '统一写法' }] }, showWriting(repo).digest);
  } finally { repo.close(); }
  writeFileSync(join(root, 'docs/sample.md'), '# Sample\n\nOld.\n');
  server = await workspace.ready();
  await waitForWorkspaceProjection(`http://127.0.0.1:${server.port}`);

  const initialPolicy = browserActionReceipt(page, 'writing.show', input => input.path === 'docs/writing.md');
  await page.goto(`http://127.0.0.1:${server.port}/writing`);
  await initialPolicy;
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
  await page.getByRole('link', { name: '写作', exact: true }).click();
  await page.getByRole('button', { name: '检查已保存文档' }).click();
  await intercepted;
  await expect(page.getByRole('button', { name: '正在检查…' })).toBeDisabled();
  await page.getByRole('link', { name: '写作', exact: true }).click();
  await page.getByLabel('替换建议 1').fill('Draft');
  await page.getByRole('link', { name: '写作', exact: true }).click();
  await expect(page.getByRole('button', { name: '检查已保存文档' })).toBeEnabled();

  const oldResponse = page.waitForResponse(response => response.url().endsWith('/api/action') && (response.request().postDataJSON() as { action?: string }).action === 'writing.check');
  releaseOld();
  await oldResponse;
  await expect(page.getByText(/某次快照的检查结果/)).toHaveCount(0);
  await page.getByRole('link', { name: '写作', exact: true }).click();
  await expect(page.getByRole('button', { name: '检查已保存文档' })).toBeEnabled();
  await page.getByRole('link', { name: '写作', exact: true }).click();
  await page.getByRole('button', { name: '检查已保存文档' }).click();
  await expect(page.getByText(/某次快照的检查结果/)).toBeVisible();
  await expect(page.getByText('Old.', { exact: true }).first()).toBeVisible();

});

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('real browser creates a local Markdown catalog, diagnoses structure and saves exact source without global scan roots', async ({ page, workspace }) => {
  const root = workspace.root;

  let server: ViewServerHandle | undefined;
  const scope = 'docs/feature/demo';

  const repo = new LocalRepository(root);
  try {
    mkdirSync(join(root, scope), { recursive: true });
    const global = showConcepts(repo);
    writeConceptFile(repo, "# Terms\n\n## Shared {#global}\n\nShared concept\n", global.digest, false, 'docs/concepts.md');
  } finally { repo.close(); }
  server = await workspace.ready();
  await waitForWorkspaceProjection(`http://127.0.0.1:${server.port}`);

  await page.setViewportSize({ width: 1440, height: 950 });
  const initialReads = Promise.all([
    browserActionReceipt(page, 'writing.show', input => input.path === 'docs/writing.md'),
    browserActionReceipt(page, 'concepts.show', input => input.path === 'docs/concepts.md'),
    browserActionReceipt(page, 'concepts.index'),
    browserActionReceipt(page, 'writing.index'),
  ]);
  await page.goto(`http://127.0.0.1:${server.port}/terms`);
  await initialReads;
  const scopeReads = Promise.all([
    ...['docs/writing.md', 'docs/feature/writing.md', `${scope}/writing.md`].map(path =>
      browserActionReceipt(page, 'writing.show', input => input.path === path)),
    browserActionReceipt(page, 'concepts.show', input => input.path === `${scope}/concepts.md`),
    browserActionReceipt(page, 'concepts.index'),
    browserActionReceipt(page, 'writing.index'),
  ]);
  await page.getByLabel('新生效范围').fill(scope);
  await page.getByRole('button', { name: '打开范围' }).click();
  // Scope discovery reads must finish before this test publishes a new owner.
  await scopeReads;
  await page.getByRole('button', { name: '创建本目录术语表' }).click();
  const source = page.getByRole('textbox', { name: '源码原文' });
  const markdown = '# Local terms\n\n## 本地 {#local}\n\nLocal definition\n\n旧写法：`Legacy`\n\n### Explanation\n\nUse `Legacy` only in code.\n';
  await source.fill('# Local terms\n\n## Missing ID\n');
  await expect(page.getByRole('alert')).toContainText('InvalidConceptCatalog');
  await expect(page.getByRole('button', { name: '保存术语' })).toBeDisabled();
  await source.fill(markdown);
  await page.getByRole('button', { name: '保存术语' }).click();
  await expect(page.getByRole('region', { name: '术语表编辑' }).getByRole('status')).toHaveText('术语已保存。');
  await expect.poll(() => readFileSync(join(root, scope, 'concepts.md'), 'utf8')).toBe(markdown);
  await expect(page.getByRole('list', { name: '术语列表' }).getByRole('button', { name: /本地/ })).toBeVisible();

  await page.getByRole('link', { name: '写作', exact: true }).click();
  await expect(page.getByLabel('上级写作规则')).toContainText('140');
  await expect(page.getByLabel('上级写作规则')).toContainText('320');
  await expect(page.getByText('沿用上级规则，尚无本范围的调整')).toBeVisible();
  await page.getByRole('button', { name: '添加规则' }).click();
  await page.getByLabel('句子长度', { exact: true }).fill('');
  await expect(page.getByLabel('SVG 样式继承方式')).toHaveCount(0);
  await page.getByRole('link', { name: '写作', exact: true }).click();
  await page.getByRole('button', { name: '保存规则' }).click();
  await expect(page.getByRole('region', { name: '写作规则编辑' }).getByRole('status')).toHaveText('写作规则已保存。');
  await expect.poll(() => parseWritingPolicy(readFileSync(join(root, scope, 'writing.md'), 'utf8')).sentenceLength).toBe(undefined);
  const policy = parseWritingPolicy(readFileSync(join(root, scope, 'writing.md'), 'utf8')) as { roots?: string[]; svgStyle?: null };
  assert.equal(policy.roots, undefined);
  assert.equal(policy.svgStyle, undefined);

});
