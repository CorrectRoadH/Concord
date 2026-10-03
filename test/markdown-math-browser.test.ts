import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, expect, type Browser, type Locator } from '@playwright/test';
import { Effect } from 'effect';
import { createDocument } from '../dist/documents.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import { startViewServer, type ViewServerHandle } from '../dist/view-server.js';

const example = String.raw`P(\Phi_h(S))=P(S)`;
const inline = String.raw`\frac{a}{b} + x^2`;
const long = String.raw`\underbrace{` + Array.from({ length: 70 }, (_, i) => `x_{${i}}`).join('+') + String.raw`}_{\text{long formula}}`;
const body = [
  '# Math rendering', '', 'Inline $' + inline + '$ remains in this paragraph.', '',
  '$\\text{[fake](../math-decoy/README.md)}$', '', '[Linked document](../math-target/README.md)', '',
  '$$', example, '$$', '', '$$', long, '$$', '',
  'Literal `$P(\\Phi_h(S))=P(S)$`.', '',
  '```math', '$P(\\Phi_h(S))=P(S)$', '$$', 'x^2', '$$', '```', '',
  '```text', '$inline code$ and $$block code$$', '```', '',
  'Invalid $\\frac{$.', '',
  '$\\href{javascript:alert(1)}{unsafe-link}$', '',
  '$\\href{https://evil.invalid/}{external-link}$', '',
  '$\\includegraphics{https://evil.invalid/pixel.png}$', '',
  '$\\htmlClass{math-spoof}{x}$', '',
  '$\\htmlStyle{background:url(https://evil.invalid/style)}{x}$', '',
  '$\\htmlId{math-spoof-id}{x}$', '',
  '$\\def\\a{\\a}\\a$', '',
  '<span class="math-inline" onclick="window.mathAttack=true">spoof-inline</span>', '',
  '<div class="math-display" style="background:url(https://evil.invalid/raw)">spoof-display</div>', '',
  '<pre><code class="language-math">spoof-code</code></pre>', '',
  '<concord-inline-math>spoof-private-tag</concord-inline-math>', '',
  '<script>window.mathAttack=true</script><iframe src="https://evil.invalid/frame"></iframe>', '',
  '<a href="javascript:alert(1)">bad-html-link</a>', '',
  'SAFE END', '',
].join('\n');

async function assertMath(preview: Locator): Promise<void> {
  await expect(preview.locator('.katex-display')).toHaveCount(2);
  await expect(preview.locator('annotation').filter({ hasText: example })).toHaveCount(1);
  await expect(preview.locator('annotation').filter({ hasText: inline })).toHaveCount(1);
  await expect(preview.locator('.concord-math--inline').first()).toHaveCount(1);
  await expect(preview.locator('code').filter({ hasText: '$P(\\Phi_h(S))=P(S)$' })).toHaveCount(2);
  await expect(preview.locator('pre code .katex')).toHaveCount(0);
  await expect(preview.locator('code .katex')).toHaveCount(0);
  await expect(preview.locator('.katex-error').filter({ hasText: '\\frac{' })).toBeVisible();
  await expect(preview.getByText('SAFE END', { exact: true })).toBeVisible();
  await expect(preview.locator('script, iframe, [onclick], .math-spoof, #math-spoof-id, a[href^="javascript:"], img[src*="evil.invalid"], [style*="evil.invalid"]')).toHaveCount(0);
  await expect(preview.getByText('spoof-inline', { exact: true })).toBeVisible();
  await expect(preview.getByText('spoof-display', { exact: true })).toBeVisible();
  await expect(preview.getByText('spoof-code', { exact: true })).toBeVisible();
  await expect(preview.locator('.concord-math').filter({ hasText: /spoof-(inline|display|code|private-tag)/ })).toHaveCount(0);
}

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('real workbench math previews render locally, sanitize HTML and preserve Markdown bytes', { timeout: 120000 }, () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-math-browser-'));
  let server: ViewServerHandle | undefined;
  let browser: Browser | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try {
      initialize(repo, false, { testRoots: [] });
      createDocument(repo, 'feature', { id: 'math', title: 'Math rendering', body });
      createDocument(repo, 'feature', { id: 'math-target', title: 'Linked math document' });
      createDocument(repo, 'feature', { id: 'math-decoy', title: 'Formula text is not a link' });
    } finally { repo.close(); }
    const file = join(root, 'docs/feature/math/README.md');
    const before = readFileSync(file);
    const projectPath = join(root, 'docs/math.md');
    const projectBody = '\uFEFF---\r\ntitle: Math source\r\n---\r\n\r\n' + body.replaceAll('\n', '\r\n');
    writeFileSync(projectPath, projectBody);
    const projectBefore = readFileSync(projectPath);
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    const address = `http://127.0.0.1:${server.port}`;
    const executablePath = process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    const externalRequests: string[] = [];
    const fonts: { url: string; status: number }[] = [];
    const blockedFonts: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.text().includes('font-src')) blockedFonts.push(message.text()); });
    page.on('request', request => { if (/^https?:/u.test(request.url()) && new URL(request.url()).origin !== address) externalRequests.push(request.url()); });
    page.on('response', response => { if (/KaTeX.*\.(?:woff2?|ttf)(?:\?|$)/u.test(response.url())) fonts.push({ url: response.url(), status: response.status() }); });
    await page.goto(`${address}/features/math`);
    const preview = page.getByTestId('markdown-preview');
    const editor = page.getByRole('textbox', { name: 'Markdown 原文', exact: true, includeHidden: true });
    await expect(editor).toHaveValue(body, { timeout: 20000 });
    await expect(editor).not.toBeVisible();
    await assertMath(preview);
    assert.equal(await page.evaluate(() => Object.hasOwn(window, 'mathAttack')), false);
    await preview.locator('.katex-display').first().scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => fonts.length).toBeGreaterThan(0);
    assert.ok(fonts.every(font => font.status === 200 && new URL(font.url).origin === address), 'KaTeX fonts are served by the local workbench');
    assert.deepEqual(blockedFonts, [], 'Font assets must satisfy the same-origin CSP');
    await expect(preview.locator('.katex .mathnormal').first()).toHaveCSS('font-family', /KaTeX_Math/);
    await page.getByText('查看原文与元数据', { exact: true }).click();
    await expect(page.getByTestId('math-document-editor').locator('.content-record__details pre')).toHaveText(body);
    for (const theme of ['dark', 'light'] as const) {
      await page.getByRole('button', { name: theme === 'dark' ? '切换至深色主题' : '切换至浅色主题', exact: true }).click();
      assert.equal(await preview.locator('.katex').first().evaluate(element => getComputedStyle(element).color === getComputedStyle(element.closest('article')!).color), true);
      await expect(preview.locator('.katex-error').first()).toHaveCSS('color', theme === 'dark' ? 'rgb(216, 107, 98)' : 'rgb(180, 59, 50)');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const longBlock = preview.locator('.concord-math--display').nth(1);
    await expect(longBlock).toHaveCSS('overflow-x', 'auto');
    assert.equal(await longBlock.evaluate(element => element.scrollWidth > element.clientWidth), true);
    await longBlock.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    assert.ok(await longBlock.evaluate(element => element.scrollLeft > 0));
    assert.deepEqual(readFileSync(file), before);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${address}/docs?file=docs%2Fmath.md`);
    await expect(editor).toHaveValue(projectBody.replaceAll('\r\n', '\n'));
    await expect(editor).not.toBeVisible();
    await assertMath(preview);
    assert.deepEqual(readFileSync(projectPath), projectBefore, 'BOM and CRLF source survive project Markdown preview');
    await page.goto(`${address}/features/math`);
    await expect(editor).toHaveValue(body);
    await expect(editor).not.toBeVisible();
    await page.getByText('编辑原文', { exact: true }).click();
    await expect(editor).toBeVisible();
    const changed = body.replace(inline, () => String.raw`\frac{a}{b} + x^3`);
    await editor.fill(changed);
    await expect(preview.locator('annotation').filter({ hasText: String.raw`\frac{a}{b} + x^3` })).toHaveCount(1);
    await expect.poll(() => readFileSync(file, 'utf8')).toBe(before.toString('utf8').replace(body, () => changed));
    await preview.getByRole('link', { name: 'Linked document', exact: true }).click();
    await expect(page).toHaveURL(/\/features\/math-target$/u);
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
  } finally {
    await browser?.close();
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
})));
